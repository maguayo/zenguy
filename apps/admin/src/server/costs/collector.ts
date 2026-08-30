import type { UsageProbeResult } from "../../shared/types";
import type { UsageRow } from "../db/usage";

export type GraphqlClient = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<{ data: unknown }>;

export interface ProbeRange {
  accountTag: string;
  fromDay: string;
  toDay: string;
}

export interface Probe {
  name: string;
  run(client: GraphqlClient, range: ProbeRange): Promise<UsageRow[]>;
}

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const REQUEST_TIMEOUT_MS = 20_000;

/** Minimal client: bearer auth, one POST per query, GraphQL errors become throws. */
export function cloudflareGraphql(fetchImpl: typeof fetch, token: string): GraphqlClient {
  return async (query, variables) => {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "zenguy-admin/1.0",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as {
      data?: unknown;
      errors?: { message?: string }[] | null;
    };
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error(payload.errors.map((error) => error.message ?? "GraphQL error").join("; "));
    }
    return { data: payload.data ?? null };
  };
}

type Node = { dimensions?: Record<string, unknown>; sum?: Record<string, unknown>; max?: Record<string, unknown> };

function nodes(data: unknown, dataset: string): Node[] {
  const account = (data as { viewer?: { accounts?: Record<string, unknown>[] } } | null)?.viewer
    ?.accounts?.[0];
  const list = account?.[dataset];
  return Array.isArray(list) ? (list as Node[]) : [];
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function day(node: Node): string | null {
  const value = node.dimensions?.date;
  return typeof value === "string" ? value : null;
}

/** Sums (day, metric) contributions so a per-database or per-bucket split folds into one row. */
class Rows {
  private readonly totals = new Map<string, UsageRow>();

  add(dayKey: string | null, metric: string, value: number): void {
    if (dayKey === null) return;
    const key = `${dayKey}|${metric}`;
    const current = this.totals.get(key);
    if (current === undefined) this.totals.set(key, { day: dayKey, metric, value });
    else current.value += value;
  }

  list(): UsageRow[] {
    return [...this.totals.values()].sort((a, b) =>
      a.day === b.day ? a.metric.localeCompare(b.metric) : a.day.localeCompare(b.day),
    );
  }
}

function dateVariables(range: ProbeRange) {
  return { accountTag: range.accountTag, from: range.fromDay, to: range.toDay };
}

function timeVariables(range: ProbeRange) {
  return {
    accountTag: range.accountTag,
    from: `${range.fromDay}T00:00:00Z`,
    to: `${range.toDay}T23:59:59Z`,
  };
}

function accountQuery(dataset: string, args: string, selection: string, dateTyped: boolean): string {
  const scalar = dateTyped ? "Date" : "Time";
  return `query ($accountTag: string!, $from: ${scalar}!, $to: ${scalar}!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    ${dataset}(limit: 10000, filter: { ${args} }) { ${selection} }
  } }
}`;
}

const DATE_ARGS = "date_geq: $from, date_leq: $to";
const TIME_ARGS = "datetime_geq: $from, datetime_leq: $to";

/** A simple probe: one dataset, `date` dimension, a list of sum fields → metrics. */
function sumProbe(
  name: string,
  dataset: string,
  dateTyped: boolean,
  fields: Record<string, { metric: string; scale?: number }>,
): Probe {
  const query = accountQuery(
    dataset,
    dateTyped ? DATE_ARGS : TIME_ARGS,
    `dimensions { date } sum { ${Object.keys(fields).join(" ")} }`,
    dateTyped,
  );
  return {
    name,
    async run(client, range) {
      const { data } = await client(query, dateTyped ? dateVariables(range) : timeVariables(range));
      const rows = new Rows();
      for (const node of nodes(data, dataset)) {
        for (const [field, spec] of Object.entries(fields)) {
          rows.add(day(node), spec.metric, num(node.sum?.[field]) * (spec.scale ?? 1));
        }
      }
      return rows.list();
    },
  };
}

/** Storage-style probe: per-resource daily maximum, summed across resources. */
function storageProbe(
  name: string,
  dataset: string,
  dateTyped: boolean,
  resourceDimension: string,
  maxFields: readonly string[],
  metric: string,
): Probe {
  const query = accountQuery(
    dataset,
    dateTyped ? DATE_ARGS : TIME_ARGS,
    `dimensions { date ${resourceDimension} } max { ${maxFields.join(" ")} }`,
    dateTyped,
  );
  return {
    name,
    async run(client, range) {
      const { data } = await client(query, dateTyped ? dateVariables(range) : timeVariables(range));
      const rows = new Rows();
      for (const node of nodes(data, dataset)) {
        rows.add(
          day(node),
          metric,
          maxFields.reduce((sum, field) => sum + num(node.max?.[field]), 0),
        );
      }
      return rows.list();
    },
  };
}

/** Operations split by `actionType` into one metric per class. */
function actionProbe(
  name: string,
  dataset: string,
  dateTyped: boolean,
  classify: (actionType: string) => string | null,
): Probe {
  const query = accountQuery(
    dataset,
    dateTyped ? DATE_ARGS : TIME_ARGS,
    "dimensions { date actionType } sum { requests }",
    dateTyped,
  );
  return {
    name,
    async run(client, range) {
      const { data } = await client(query, dateTyped ? dateVariables(range) : timeVariables(range));
      const rows = new Rows();
      for (const node of nodes(data, dataset)) {
        const action = node.dimensions?.actionType;
        const metric = typeof action === "string" ? classify(action) : null;
        if (metric !== null) rows.add(day(node), metric, num(node.sum?.requests));
      }
      return rows.list();
    },
  };
}

const GIB = 1024 ** 3;
const GB = 1_000_000_000;
// Durable Object duration bills wall-clock active time at an assumed 128 MB.
const DO_GB_PER_ACTIVE_SECOND = 0.125;

// R2 pricing classes (developers.cloudflare.com/r2/pricing); deletes are free.
const R2_CLASS_A = new Set([
  "ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject",
  "CompleteMultipartUpload", "CreateMultipartUpload", "LifecycleStorageTierTransition",
  "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts",
  "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration",
]);
const R2_CLASS_B = new Set([
  "HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption",
  "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration",
]);

/**
 * One request per dataset on purpose: a GraphQL document fails as a whole when
 * any field is unknown, and several of these fields are introspection-derived
 * rather than documented. A wrong guess must cost one probe, not the night's run.
 */
export const PROBES: readonly Probe[] = [
  sumProbe("workers", "workersInvocationsAdaptive", false, {
    requests: { metric: "workers.requests" },
    errors: { metric: "workers.errors" },
    subrequests: { metric: "workers.subrequests" },
  }),
  // cpuTimeUs is not in the docs (introspection-derived); kept apart so a rename
  // never hides the request counts.
  sumProbe("workers-cpu", "workersInvocationsAdaptive", false, {
    cpuTimeUs: { metric: "workers.cpu_ms", scale: 1 / 1_000 },
  }),
  sumProbe("d1", "d1AnalyticsAdaptiveGroups", true, {
    readQueries: { metric: "d1.read_queries" },
    writeQueries: { metric: "d1.write_queries" },
    rowsRead: { metric: "d1.rows_read" },
    rowsWritten: { metric: "d1.rows_written" },
  }),
  storageProbe("d1-storage", "d1StorageAdaptiveGroups", true, "databaseId", ["databaseSizeBytes"], "d1.storage_bytes"),
  sumProbe("do", "durableObjectsInvocationsAdaptiveGroups", true, {
    requests: { metric: "do.requests" },
  }),
  // activeTime is assumed to be microseconds — verify against the first real run.
  sumProbe("do-duration", "durableObjectsPeriodicGroups", true, {
    activeTime: { metric: "do.duration_gbs", scale: DO_GB_PER_ACTIVE_SECOND / 1_000_000 },
  }),
  sumProbe("containers", "containersUsageAdaptiveGroups", true, {
    cpuTimeSec: { metric: "containers.vcpu_s" },
    allocatedMemory: { metric: "containers.memory_gib_s", scale: 1 / GIB },
    allocatedDisk: { metric: "containers.disk_gb_s", scale: 1 / GB },
  }),
  actionProbe("kv", "kvOperationsAdaptiveGroups", true, (action) => {
    switch (action) {
      case "read": return "kv.reads";
      case "write": return "kv.writes";
      case "delete": return "kv.deletes";
      case "list": return "kv.lists";
      default: return null;
    }
  }),
  storageProbe("kv-storage", "kvStorageAdaptiveGroups", true, "namespaceId", ["byteCount"], "kv.storage_bytes"),
  actionProbe("r2", "r2OperationsAdaptiveGroups", false, (action) =>
    R2_CLASS_A.has(action) ? "r2.class_a" : R2_CLASS_B.has(action) ? "r2.class_b" : null,
  ),
  storageProbe("r2-storage", "r2StorageAdaptiveGroups", false, "bucketName", ["payloadSize", "metadataSize"], "r2.storage_bytes"),
  sumProbe("queues", "queueMessageOperationsAdaptiveGroups", false, {
    billableOperations: { metric: "queues.operations" },
  }),
];

export async function collectUsage(
  client: GraphqlClient,
  range: ProbeRange,
): Promise<{ rows: UsageRow[]; probes: UsageProbeResult[] }> {
  const rows: UsageRow[] = [];
  const probes: UsageProbeResult[] = [];
  const results = await Promise.all(
    PROBES.map(async (probe) => {
      try {
        const produced = await probe.run(client, range);
        return { probe: probe.name, ok: true, rows: produced.length, produced };
      } catch (error) {
        return {
          probe: probe.name,
          ok: false,
          rows: 0,
          produced: [] as UsageRow[],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  for (const result of results) {
    const { produced, ...summary } = result;
    rows.push(...produced);
    probes.push(summary);
  }
  return { rows, probes };
}

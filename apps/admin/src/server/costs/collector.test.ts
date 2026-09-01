import { describe, expect, it, vi } from "vitest";

import { PROBES, cloudflareGraphql, collectUsage } from "./collector";
import type { GraphqlClient } from "./collector";

const DAY = "2026-08-29";
const GIB = 1024 ** 3;

/** One documented response shape per dataset, keyed by the dataset the query names. */
const FIXTURES: Record<string, unknown[]> = {
  workersInvocationsAdaptive: [
    { dimensions: { date: DAY }, sum: { requests: 1_000, errors: 5, subrequests: 20, cpuTimeUs: 2_500_000 } },
  ],
  d1AnalyticsAdaptiveGroups: [
    { dimensions: { date: DAY }, sum: { readQueries: 10, writeQueries: 2, rowsRead: 5_000, rowsWritten: 40 } },
  ],
  d1StorageAdaptiveGroups: [
    { dimensions: { date: DAY, databaseId: "a" }, max: { databaseSizeBytes: 1_000_000 } },
    { dimensions: { date: DAY, databaseId: "b" }, max: { databaseSizeBytes: 2_000_000 } },
  ],
  durableObjectsInvocationsAdaptiveGroups: [{ dimensions: { date: DAY }, sum: { requests: 300 } }],
  durableObjectsPeriodicGroups: [{ dimensions: { date: DAY }, sum: { activeTime: 8_000_000 } }],
  containersUsageAdaptiveGroups: [
    {
      dimensions: { date: DAY },
      sum: { cpuTimeSec: 120, allocatedMemory: 2 * GIB, allocatedDisk: 3_000_000_000 },
    },
  ],
  kvOperationsAdaptiveGroups: [
    { dimensions: { date: DAY, actionType: "read" }, sum: { requests: 50 } },
    { dimensions: { date: DAY, actionType: "write" }, sum: { requests: 5 } },
    { dimensions: { date: DAY, actionType: "delete" }, sum: { requests: 1 } },
    { dimensions: { date: DAY, actionType: "list" }, sum: { requests: 2 } },
  ],
  kvStorageAdaptiveGroups: [
    { dimensions: { date: DAY, namespaceId: "n1" }, max: { byteCount: 1_000 } },
  ],
  r2OperationsAdaptiveGroups: [
    { dimensions: { date: DAY, actionType: "PutObject" }, sum: { requests: 7 } },
    { dimensions: { date: DAY, actionType: "GetObject" }, sum: { requests: 30 } },
    { dimensions: { date: DAY, actionType: "DeleteObject" }, sum: { requests: 4 } },
  ],
  r2StorageAdaptiveGroups: [
    { dimensions: { date: DAY, bucketName: "b" }, max: { payloadSize: 5_000_000_000, metadataSize: 1_000_000 } },
  ],
  queueMessageOperationsAdaptiveGroups: [
    { dimensions: { date: DAY }, sum: { billableOperations: 900 } },
  ],
};

function fixtureClient(overrides: Partial<Record<string, unknown[] | Error>> = {}): GraphqlClient {
  return async (query) => {
    const dataset = Object.keys(FIXTURES).find((name) => query.includes(`${name}(`));
    if (dataset === undefined) throw new Error(`unexpected query: ${query.slice(0, 80)}`);
    const override = overrides[dataset];
    if (override instanceof Error) throw override;
    return { data: { viewer: { accounts: [{ [dataset]: override ?? FIXTURES[dataset] }] } } };
  };
}

const RANGE = { accountTag: "acct", fromDay: "2026-08-27", toDay: DAY };

describe("collectUsage", () => {
  it("maps every documented dataset onto platform metrics", async () => {
    const { rows, probes } = await collectUsage(fixtureClient(), RANGE);
    const byMetric = Object.fromEntries(rows.map((row) => [row.metric, row.value]));
    expect(rows.every((row) => row.day === DAY)).toBe(true);
    expect(byMetric).toEqual({
      "workers.requests": 1_000,
      "workers.errors": 5,
      "workers.subrequests": 20,
      "workers.cpu_ms": 2_500,
      "d1.read_queries": 10,
      "d1.write_queries": 2,
      "d1.rows_read": 5_000,
      "d1.rows_written": 40,
      "d1.storage_bytes": 3_000_000,
      "do.requests": 300,
      "do.duration_gbs": 1, // 8 s of active time × 128 MB
      "containers.vcpu_s": 120,
      "containers.memory_gib_s": 2,
      "containers.disk_gb_s": 3,
      "kv.reads": 50,
      "kv.writes": 5,
      "kv.deletes": 1,
      "kv.lists": 2,
      "kv.storage_bytes": 1_000,
      "r2.class_a": 7,
      "r2.class_b": 30,
      "r2.storage_bytes": 5_001_000_000,
      "queues.operations": 900,
    });
    expect(probes.every((probe) => probe.ok)).toBe(true);
    expect(probes.map((probe) => probe.probe)).toEqual(PROBES.map((probe) => probe.name));
  });

  it("isolates a failing dataset instead of losing the whole collection", async () => {
    const client = fixtureClient({
      workersInvocationsAdaptive: new Error("Cannot query field cpuTimeUs"),
    });
    const { rows, probes } = await collectUsage(client, RANGE);
    const workers = probes.filter((probe) => probe.probe.startsWith("workers"));
    expect(workers.some((probe) => !probe.ok && probe.error?.includes("cpuTimeUs"))).toBe(true);
    expect(rows.some((row) => row.metric === "d1.rows_read")).toBe(true);
    expect(rows.some((row) => row.metric === "workers.cpu_ms")).toBe(false);
  });

  it("treats an empty dataset as zero rows, not an error", async () => {
    const { rows, probes } = await collectUsage(
      fixtureClient({ queueMessageOperationsAdaptiveGroups: [] }),
      RANGE,
    );
    expect(probes.find((probe) => probe.probe === "queues")).toEqual({ probe: "queues", ok: true, rows: 0 });
    expect(rows.some((row) => row.metric === "queues.operations")).toBe(false);
  });

  it("uses matching datetime filters and values for Containers", async () => {
    const containers = PROBES.find((probe) => probe.name === "containers");
    expect(containers).toBeDefined();
    const client = vi.fn<GraphqlClient>(async () => ({
      data: { viewer: { accounts: [{ containersUsageAdaptiveGroups: [] }] } },
    }));

    await containers!.run(client, RANGE);

    expect(client).toHaveBeenCalledOnce();
    const [query, variables] = client.mock.calls[0]!;
    expect(query).toContain("$from: Time");
    expect(query).toContain("datetime_geq: $from, datetime_leq: $to");
    expect(query).not.toContain("date_geq:");
    expect(variables).toEqual({
      accountTag: "acct",
      from: "2026-08-27T00:00:00Z",
      to: "2026-08-29T23:59:59Z",
    });
  });
});

describe("cloudflareGraphql", () => {
  it("posts the query with the bearer token and surfaces GraphQL errors as failures", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      return new Response(
        JSON.stringify(
          body.query.includes("bad")
            ? { data: null, errors: [{ message: "field not found" }] }
            : { data: { ok: true }, errors: null },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const client = cloudflareGraphql(fetchImpl as unknown as typeof fetch, "tok");

    await expect(client("query { good }", {})).resolves.toEqual({ data: { ok: true } });
    await expect(client("query { bad }", {})).rejects.toThrow("field not found");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/graphql");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
  });

  it("reports non-2xx answers with their status", async () => {
    const client = cloudflareGraphql(
      (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch,
      "tok",
    );
    await expect(client("query { x }", {})).rejects.toThrow("HTTP 403");
  });
});

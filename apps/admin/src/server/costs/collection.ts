import type { UsageCollection } from "../../shared/types";
import { latestCollection, recordCollection, upsertUsage } from "../db/usage";
import type { Clock } from "../env";
import { cloudflareGraphql, collectUsage } from "./collector";

export interface CollectionDeps {
  db: D1Database;
  fetch: typeof fetch;
  /** Absent until the operator installs CF_ANALYTICS_API_TOKEN. */
  token: string | undefined;
  accountId: string;
  clock: Clock;
}

export interface CollectionOptions {
  source: UsageCollection["source"];
  /** Days to (re)collect, ending today; re-collecting a day overwrites it. */
  days: number;
}

const DAY_MS = 86_400_000;
/** The nightly cron re-reads the last three days: late analytics settle, missed nights heal. */
const NIGHTLY_DAYS = 3;
const BACKFILL_DAYS = 30;

function utcDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

/** One collection: every probe, an upsert of whatever came back, and a run record. */
export async function runCollection(
  deps: CollectionDeps,
  options: CollectionOptions,
): Promise<UsageCollection | null> {
  if (deps.token === undefined || deps.token.trim() === "") return null;
  const startedAt = deps.clock.now();
  const toDay = utcDay(startedAt);
  const fromDay = utcDay(startedAt - (options.days - 1) * DAY_MS);
  const client = cloudflareGraphql(deps.fetch, deps.token);
  const { rows, probes } = await collectUsage(client, {
    accountTag: deps.accountId,
    fromDay,
    toDay,
  });
  await upsertUsage(deps.db, rows, startedAt);
  const succeeded = probes.filter((probe) => probe.ok).length;
  const collection: UsageCollection = {
    id: crypto.randomUUID(),
    source: options.source,
    status: succeeded === probes.length ? "OK" : succeeded === 0 ? "FAILED" : "PARTIAL",
    fromDay,
    toDay,
    startedAt,
    finishedAt: deps.clock.now(),
    probes,
  };
  await recordCollection(deps.db, collection);
  return collection;
}

/** A month on the first ever run so the dashboard is not empty; a few days after. */
export async function scheduledCollectionDays(db: D1Database): Promise<number> {
  return (await latestCollection(db)) === null ? BACKFILL_DAYS : NIGHTLY_DAYS;
}

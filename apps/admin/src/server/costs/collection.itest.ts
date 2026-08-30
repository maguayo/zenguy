import { env } from "cloudflare:test";
import { latestCollection, loadUsage } from "../db/usage";
import { runCollection, scheduledCollectionDays } from "./collection";

const NOW = 1_700_000_000_000; // 2023-11-14T22:13:20Z
const DAY = 86_400_000;

/** Answers the workers and d1 datasets; every other dataset is "unknown field". */
function fakeFetch(): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    const answer = (dataset: string, list: unknown[]) =>
      new Response(JSON.stringify({ data: { viewer: { accounts: [{ [dataset]: list }] } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (query.includes("workersInvocationsAdaptive(") && query.includes("requests")) {
      return answer("workersInvocationsAdaptive", [
        { dimensions: { date: "2023-11-13" }, sum: { requests: 100, errors: 1, subrequests: 3 } },
        { dimensions: { date: "2023-11-14" }, sum: { requests: 50, errors: 0, subrequests: 1 } },
      ]);
    }
    if (query.includes("d1AnalyticsAdaptiveGroups(")) {
      return answer("d1AnalyticsAdaptiveGroups", [
        { dimensions: { date: "2023-11-14" }, sum: { readQueries: 1, writeQueries: 1, rowsRead: 20, rowsWritten: 2 } },
      ]);
    }
    return new Response(JSON.stringify({ data: null, errors: [{ message: "unknown field" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM platform_usage_daily"),
    env.DB.prepare("DELETE FROM platform_usage_collections"),
  ]);
}

describe("runCollection", () => {
  beforeEach(reset);

  it("persists what the probes returned and records a partial collection", async () => {
    const collection = await runCollection(
      { db: env.DB, fetch: fakeFetch(), token: "tok", accountId: "acct", clock: { now: () => NOW } },
      { source: "manual", days: 3 },
    );
    expect(collection).toMatchObject({
      source: "manual",
      status: "PARTIAL",
      fromDay: "2023-11-12",
      toDay: "2023-11-14",
      startedAt: NOW,
    });
    expect(collection?.probes.find((probe) => probe.probe === "workers")).toEqual({
      probe: "workers",
      ok: true,
      rows: 6,
    });
    expect(collection?.probes.find((probe) => probe.probe === "queues")).toMatchObject({
      ok: false,
      error: "unknown field",
    });

    const rows = await loadUsage(env.DB, "2023-11-12", "2023-11-14");
    expect(rows).toContainEqual({ day: "2023-11-13", metric: "workers.requests", value: 100 });
    expect(rows).toContainEqual({ day: "2023-11-14", metric: "d1.rows_read", value: 20 });
    expect(await latestCollection(env.DB)).toEqual(collection);
  });

  it("does nothing without an analytics token", async () => {
    const collection = await runCollection(
      { db: env.DB, fetch: fakeFetch(), token: undefined, accountId: "acct", clock: { now: () => NOW } },
      { source: "cron", days: 3 },
    );
    expect(collection).toBeNull();
    expect(await latestCollection(env.DB)).toBeNull();
  });

  it("backfills a month on the very first scheduled run, then only the last days", async () => {
    expect(await scheduledCollectionDays(env.DB)).toBe(30);
    await runCollection(
      { db: env.DB, fetch: fakeFetch(), token: "tok", accountId: "acct", clock: { now: () => NOW - DAY } },
      { source: "cron", days: 3 },
    );
    expect(await scheduledCollectionDays(env.DB)).toBe(3);
  });
});

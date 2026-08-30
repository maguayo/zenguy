import { env } from "cloudflare:test";
import {
  latestCollection,
  loadUsage,
  recordCollection,
  upsertUsage,
} from "./usage";

const NOW = 1_700_000_000_000;

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM platform_usage_daily"),
    env.DB.prepare("DELETE FROM platform_usage_collections"),
  ]);
}

describe("platform usage store", () => {
  beforeEach(reset);

  it("upserts daily rows idempotently and reads them back by day range", async () => {
    await upsertUsage(
      env.DB,
      [
        { day: "2023-11-13", metric: "workers.requests", value: 1_000 },
        { day: "2023-11-13", metric: "d1.rows_read", value: 5_000 },
        { day: "2023-11-14", metric: "workers.requests", value: 2_000 },
      ],
      NOW,
    );
    // A re-collection of the same day replaces the value instead of duplicating it.
    await upsertUsage(env.DB, [{ day: "2023-11-13", metric: "workers.requests", value: 1_100 }], NOW + 1);

    const rows = await loadUsage(env.DB, "2023-11-13", "2023-11-14");
    expect(rows).toEqual([
      { day: "2023-11-13", metric: "d1.rows_read", value: 5_000 },
      { day: "2023-11-13", metric: "workers.requests", value: 1_100 },
      { day: "2023-11-14", metric: "workers.requests", value: 2_000 },
    ]);
    expect(await loadUsage(env.DB, "2023-11-14", "2023-11-20")).toHaveLength(1);
  });

  it("records collections and returns the latest one with its probe details", async () => {
    expect(await latestCollection(env.DB)).toBeNull();
    await recordCollection(env.DB, {
      id: "col_1",
      source: "cron",
      status: "PARTIAL",
      fromDay: "2023-11-11",
      toDay: "2023-11-13",
      startedAt: NOW - 10_000,
      finishedAt: NOW - 9_000,
      probes: [
        { probe: "workers", ok: true, rows: 3 },
        { probe: "containers", ok: false, rows: 0, error: "Cannot query field" },
      ],
    });
    await recordCollection(env.DB, {
      id: "col_2",
      source: "manual",
      status: "OK",
      fromDay: "2023-11-14",
      toDay: "2023-11-14",
      startedAt: NOW,
      finishedAt: NOW + 500,
      probes: [{ probe: "workers", ok: true, rows: 1 }],
    });

    const latest = await latestCollection(env.DB);
    expect(latest).toEqual({
      id: "col_2",
      source: "manual",
      status: "OK",
      fromDay: "2023-11-14",
      toDay: "2023-11-14",
      startedAt: NOW,
      finishedAt: NOW + 500,
      probes: [{ probe: "workers", ok: true, rows: 1 }],
    });
  });

  it("accepts an empty upsert without touching the database", async () => {
    await upsertUsage(env.DB, [], NOW);
    expect(await loadUsage(env.DB, "2000-01-01", "2100-01-01")).toEqual([]);
  });
});

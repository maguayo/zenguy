import { env } from "cloudflare:test";
import { loadMetrics } from "./metrics";

// 2023-11-14T22:13:20Z — mid-day UTC so "1-3 hours ago" stays inside today.
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const U1 = "usr_00000000000000000000000001"; // veteran, active via refresh token
const U2 = "usr_00000000000000000000000002"; // veteran, silent 30d -> danger
const U3 = "usr_00000000000000000000000003"; // signed up inside the range
const U4 = "usr_00000000000000000000000004"; // veteran, active via activity event

const TABLES = [
  "activity_events",
  "incidents",
  "uptime_checks",
  "uptime_monitors",
  "test_attempts",
  "test_runs",
  "browser_tests",
  "workspace_members",
  "workspaces",
  "refresh_tokens",
  "users",
] as const;

const ACTIVITY_DDL = [
  `CREATE TABLE IF NOT EXISTS activity_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    user_id TEXT,
    workspace_id TEXT,
    source TEXT NOT NULL CHECK (source IN ('web','app','api','server')),
    resource_type TEXT,
    resource_id TEXT,
    properties_json TEXT,
    occurred_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_activity_ws_time ON activity_events (workspace_id, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activity_ws_type_time ON activity_events (workspace_id, type, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activity_user_time ON activity_events (user_id, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_events (occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activity_user_type_time ON activity_events (user_id, type, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activity_type_time ON activity_events (type, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_activity_ws_source_time ON activity_events (workspace_id, source, occurred_at DESC)",
] as const;

function user(id: string, createdAt: number) {
  return env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, email_verified_at, created_at, updated_at)
     VALUES (?, ?, ?, 'hash', ?, ?, ?)`,
  ).bind(id, id.slice(-4), `${id.slice(-4)}@example.com`, createdAt, createdAt, createdAt);
}

function workspace(id: string, owner: string) {
  return env.DB.prepare(
    `INSERT INTO workspaces (id, name, slug, timezone, owner_user_id, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', ?, ?, ?)`,
  ).bind(id, id, id, owner, NOW - 40 * DAY, NOW);
}

function run(
  id: string,
  workspaceId: string,
  status: string,
  createdAt: number,
  durationMs: number | null,
) {
  return env.DB.prepare(
    `INSERT INTO test_runs
       (id, workspace_id, browser_test_id, source, status, snapshot_json,
        queued_at, duration_ms, created_at)
     VALUES (?, ?, NULL, 'VALIDATION', ?, '{"name":"Seed"}', ?, ?, ?)`,
  ).bind(id, workspaceId, status, createdAt, durationMs, createdAt);
}

function attempt(
  id: string,
  runId: string,
  index: number,
  status: string,
  model: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
) {
  return env.DB.prepare(
    `INSERT INTO test_attempts
       (id, test_run_id, attempt_index, status, queued_at, model_name,
        input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, runId, index, status, NOW - DAY, model, inputTokens, outputTokens, NOW - DAY);
}

function check(id: string, status: string, checkedAt: number, responseMs: number | null) {
  return env.DB.prepare(
    `INSERT INTO uptime_checks
       (id, workspace_id, uptime_monitor_id, cycle_id, attempt_index, status,
        response_time_ms, checked_at, created_at)
     VALUES (?, 'ws_one', 'um_up', ?, 0, ?, ?, ?, ?)`,
  ).bind(id, id, status, responseMs, checkedAt, checkedAt);
}

async function seed(): Promise<void> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await env.DB.batch([
    user(U1, NOW - 40 * DAY),
    user(U2, NOW - 30 * DAY),
    user(U3, NOW - 2 * DAY),
    user(U4, NOW - 20 * DAY),
    env.DB.prepare(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
       VALUES ('rt1', ?, 'hash-1', ?, ?)`,
    ).bind(U1, NOW + 30 * DAY, NOW - HOUR),
    // Old token: keeps U2 out of active7d without rescuing it from danger.
    env.DB.prepare(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
       VALUES ('rt2', ?, 'hash-2', ?, ?)`,
    ).bind(U2, NOW + 30 * DAY, NOW - 29 * DAY),
    env.DB.prepare(
      `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
       VALUES ('ae1', 'user.logged_in', ?, 'web', ?)`,
    ).bind(U4, NOW - 3 * DAY),
    env.DB.prepare(
      `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
       VALUES ('ae2', 'web.page_viewed', ?, 'web', ?)`,
    ).bind(U1, NOW - HOUR),
    env.DB.prepare(
      `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
       VALUES ('ae3', 'app.opened', ?, 'app', ?)`,
    ).bind(U1, NOW - HOUR + 1),
    env.DB.prepare(
      `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
       VALUES ('ae4', 'app.screen_viewed', ?, 'app', ?)`,
    ).bind(U4, NOW - 10 * DAY),
    // Even with a malformed web source, an automatic run outcome is not product use.
    env.DB.prepare(
      `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
       VALUES ('ae5', 'browser_test.run_passed', ?, 'web', ?)`,
    ).bind(U1, NOW - HOUR + 2),
    workspace("ws_one", U1),
    workspace("ws_two", U4),

    run("r1", "ws_one", "PASSED", NOW - 2 * DAY, 1_000),
    attempt("a1", "r1", 0, "PASSED", "qwen/qwen3.8-27b", 1_000, 500),
    run("r2", "ws_one", "FAILED", NOW - DAY, 2_000),
    attempt("a2a", "r2", 0, "FAILED", "qwen/qwen3.8-27b", 1_000, 500),
    attempt("a2b", "r2", 1, "FAILED", "qwen/qwen3.8-27b", 1_000, 500),
    run("r3", "ws_two", "PASSED", NOW - DAY, 3_000),
    attempt("a3a", "r3", 0, "FAILED", "gpt-5.6-luna", 0, 0),
    attempt("a3b", "r3", 1, "PASSED", "gpt-5.6-luna", 1_000_000, 100_000),
    run("r4", "ws_one", "TIMEOUT", NOW - HOUR, null),
    attempt("a4", "r4", 0, "TIMEOUT", "gpt-5.6-luna", 200_000, 0),
    run("r6", "ws_one", "SYSTEM_ERROR", NOW - 3 * HOUR, null),
    // Outside days=7 but inside the rolling 30d spend window.
    run("r5", "ws_two", "PASSED", NOW - 10 * DAY, 4_000),
    attempt("a5", "r5", 2, "PASSED", "gpt-5.6-luna", 400_000, 0),

    env.DB.prepare(
      `INSERT INTO uptime_monitors
         (id, workspace_id, name, url, method, expected_status, frequency_seconds,
          timeout_seconds, max_retries, next_check_at, current_status, created_at, updated_at, deleted_at)
       VALUES ('um_up', 'ws_one', 'Up', 'https://a.test', 'GET', 200, 60, 10, 0, 0, 'UP', ?, ?, NULL)`,
    ).bind(NOW - 20 * DAY, NOW),
    env.DB.prepare(
      `INSERT INTO uptime_monitors
         (id, workspace_id, name, url, method, expected_status, frequency_seconds,
          timeout_seconds, max_retries, next_check_at, current_status, created_at, updated_at, deleted_at)
       VALUES ('um_down', 'ws_one', 'Down', 'https://b.test', 'GET', 200, 60, 10, 0, 0, 'DOWN', ?, ?, NULL)`,
    ).bind(NOW - 20 * DAY, NOW),
    // Deleted monitors count nowhere.
    env.DB.prepare(
      `INSERT INTO uptime_monitors
         (id, workspace_id, name, url, method, expected_status, frequency_seconds,
          timeout_seconds, max_retries, next_check_at, current_status, created_at, updated_at, deleted_at)
       VALUES ('um_gone', 'ws_one', 'Gone', 'https://c.test', 'GET', 200, 60, 10, 0, 0, 'DOWN', ?, ?, ?)`,
    ).bind(NOW - 20 * DAY, NOW, NOW - DAY),
    check("uc1", "PASSED", NOW - 2 * DAY, 100),
    check("uc2", "PASSED", NOW - DAY, 200),
    check("uc3", "PASSED", NOW - DAY, 300),
    check("uc4", "FAILED", NOW - HOUR, null),
    env.DB.prepare(
      `INSERT INTO incidents
         (id, workspace_id, resource_type, uptime_monitor_id, status, opened_at, last_event_at, created_at)
       VALUES ('i1', 'ws_one', 'UPTIME_MONITOR', 'um_down', 'OPEN', ?, ?, ?)`,
    ).bind(NOW - DAY, NOW - DAY, NOW - DAY),
    env.DB.prepare(
      `INSERT INTO incidents
         (id, workspace_id, resource_type, uptime_monitor_id, status, opened_at, resolved_at, last_event_at, created_at)
       VALUES ('i2', 'ws_one', 'UPTIME_MONITOR', 'um_up', 'RESOLVED', ?, ?, ?, ?)`,
    ).bind(NOW - 5 * DAY, NOW - 4 * DAY, NOW - 4 * DAY, NOW - 5 * DAY),
  ]);
}

function day(offsetDaysBack: number): string {
  const start = NOW - (NOW % DAY) - offsetDaysBack * DAY;
  return new Date(start).toISOString().slice(0, 10);
}

describe("loadMetrics", () => {
  beforeEach(seed);

  it("computes the users hero", async () => {
    const metrics = await loadMetrics(env.DB, NOW, 7);
    expect(metrics.range).toEqual({ days: 7, from: day(6), to: day(0), now: NOW });
    expect(metrics.users.registered).toBe(4);
    expect(metrics.users.newInRange).toBe(1);
    expect(metrics.users.active7d).toBe(2); // U1 via token, U4 via activity event
    expect(metrics.users.danger).toBe(1); // U2: >14d old, silent 14d
    expect(metrics.users.series).toHaveLength(7);
    const byDay = new Map(metrics.users.series.map((point) => [point.day, point]));
    expect(byDay.get(day(2))).toEqual({ day: day(2), signups: 1, cumulative: 4 });
    expect(byDay.get(day(6))).toEqual({ day: day(6), signups: 0, cumulative: 3 });
    expect(byDay.get(day(0))).toEqual({ day: day(0), signups: 0, cumulative: 4 });

    const usage = metrics.users.productUsage;
    expect(usage).not.toHaveProperty("unavailable");
    if ("unavailable" in usage) throw new Error("activity migration unexpectedly missing");
    expect(usage.timezone).toBe("Europe/Madrid");
    expect(usage.overall).toEqual({
      dau: 1,
      wau: 2,
      mau: 2,
      dauMau: 0.5,
      activeUsers: 2,
      visits: 2,
      visitsPerActiveUser: 1,
    });
    expect(usage.bySource.web).toEqual({
      dau: 1,
      wau: 2,
      mau: 2,
      dauMau: 0.5,
      activeUsers: 2,
      visits: 1,
      visitsPerActiveUser: 0.5,
    });
    expect(usage.bySource.app).toEqual({
      dau: 1,
      wau: 1,
      mau: 2,
      dauMau: 0.5,
      activeUsers: 1,
      visits: 1,
      visitsPerActiveUser: 1,
    });
    expect(usage.series).toHaveLength(7);
    expect(usage.series.at(-1)).toMatchObject({
      day: "2023-11-14",
      activeUsers: 1,
      webActiveUsers: 1,
      appActiveUsers: 1,
      visits: 2,
      webVisits: 1,
      appVisits: 1,
    });
  });

  it("computes the tests hero with retries and estimated spend", async () => {
    const metrics = await loadMetrics(env.DB, NOW, 7);
    expect(metrics.tests.total).toBe(5); // r1-r4 + r6; r5 is outside the range
    expect(metrics.tests.perUser).toBeCloseTo(2.5); // 5 runs ÷ owners {U1, U4}
    expect(metrics.tests.failed2h).toBe(1); // r4 TIMEOUT 1h ago; r6 is 3h old
    expect(metrics.tests.retries).toEqual({ first: 1, second: 1, thirdPlus: 0 });
    // qwen is priced at 0; luna ($0.20 in / $1.20 out per MTok): r4 200k in = 4¢
    // today; +r3 1M in (20¢) + 100k out (12¢) = 36¢ over 7d; r5 (10d ago) adds
    // 400k in = 8¢ only to the 30d window.
    expect(metrics.tests.spendCents).toEqual({ today: 4, last7d: 36, last30d: 44 });
    const byDay = new Map(metrics.tests.series.map((point) => [point.day, point]));
    expect(byDay.get(day(2))).toEqual({
      day: day(2),
      passed: 1,
      failed: 0,
      timeout: 0,
      systemError: 0,
      total: 1,
      avgDurationMs: 1_000,
    });
    expect(byDay.get(day(1))).toEqual({
      day: day(1),
      passed: 1,
      failed: 1,
      timeout: 0,
      systemError: 0,
      total: 2,
      avgDurationMs: 2_500,
    });
    expect(byDay.get(day(0))).toEqual({
      day: day(0),
      passed: 0,
      failed: 0,
      timeout: 1,
      systemError: 1,
      total: 2,
      avgDurationMs: null,
    });
  });

  it("computes the uptime hero", async () => {
    const metrics = await loadMetrics(env.DB, NOW, 7);
    expect(metrics.uptime.upPercent).toBe(75);
    expect(metrics.uptime.monitorsTotal).toBe(2);
    expect(metrics.uptime.monitorsDown).toBe(1);
    expect(metrics.uptime.openIncidents).toBe(1);
    const byDay = new Map(metrics.uptime.series.map((point) => [point.day, point]));
    expect(byDay.get(day(1))).toEqual({ day: day(1), up: 2, down: 0, avgResponseMs: 250 });
    expect(byDay.get(day(0))).toEqual({ day: day(0), up: 0, down: 1, avgResponseMs: null });
    expect(byDay.get(day(5))).toEqual({ day: day(5), up: 0, down: 0, avgResponseMs: null });
  });

  it("keeps a 30-day range's series aligned and zero-filled", async () => {
    const metrics = await loadMetrics(env.DB, NOW, 30);
    expect(metrics.tests.total).toBe(6); // r5 now included
    expect(metrics.tests.series).toHaveLength(30);
    // U1 (40d) and U2 (30d) predate the range start; U4's signup lands 20 days back.
    expect(metrics.users.series[0]).toEqual({ day: day(29), signups: 0, cumulative: 2 });
    expect(metrics.users.series[9]).toEqual({ day: day(20), signups: 1, cumulative: 3 });
    if ("unavailable" in metrics.users.productUsage) throw new Error("activity migration unexpectedly missing");
    expect(metrics.users.productUsage.series).toHaveLength(30);
  });

  it("keeps a 90-day Madrid product-usage series bounded and zero-filled", async () => {
    const metrics = await loadMetrics(env.DB, NOW, 90);
    if ("unavailable" in metrics.users.productUsage) throw new Error("activity migration unexpectedly missing");
    expect(metrics.users.productUsage.series).toHaveLength(90);
    expect(metrics.users.productUsage.series[0]?.day).toBe("2023-08-17");
    expect(metrics.users.productUsage.series.at(-1)?.day).toBe("2023-11-14");
  });

  it("assigns product activity across the CET-to-CEST boundary using Madrid midnights", async () => {
    const dstNow = Date.parse("2026-03-30T12:00:00Z");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
         VALUES ('ae_dst_1', 'web.page_viewed', ?, 'web', ?)`,
      ).bind(U1, Date.parse("2026-03-28T22:59:59.999Z")),
      env.DB.prepare(
        `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
         VALUES ('ae_dst_2', 'web.page_viewed', ?, 'web', ?)`,
      ).bind(U2, Date.parse("2026-03-28T23:00:00Z")),
      env.DB.prepare(
        `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
         VALUES ('ae_dst_3', 'app.opened', ?, 'app', ?)`,
      ).bind(U3, Date.parse("2026-03-29T21:59:59.999Z")),
      env.DB.prepare(
        `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
         VALUES ('ae_dst_4', 'app.opened', ?, 'app', ?)`,
      ).bind(U4, Date.parse("2026-03-29T22:00:00Z")),
    ]);

    const metrics = await loadMetrics(env.DB, dstNow, 7);
    if ("unavailable" in metrics.users.productUsage) throw new Error("activity migration unexpectedly missing");
    const byDay = new Map(metrics.users.productUsage.series.map((point) => [point.day, point]));
    expect(byDay.get("2026-03-28")?.activeUsers).toBe(1);
    expect(byDay.get("2026-03-29")?.activeUsers).toBe(2);
    expect(byDay.get("2026-03-30")?.activeUsers).toBe(1);
    expect(metrics.users.productUsage.overall.dau).toBe(1);
    expect(metrics.users.productUsage.overall.wau).toBe(4);
  });

  it("excludes a new web event until it is explicitly allowlisted as human product use", async () => {
    await env.DB.prepare(
      `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
       VALUES ('ae_future', 'future.feature_used', ?, 'web', ?)`,
    ).bind(U3, NOW - HOUR).run();

    const metrics = await loadMetrics(env.DB, NOW, 7);
    if ("unavailable" in metrics.users.productUsage) throw new Error("activity migration unexpectedly missing");
    expect(metrics.users.productUsage.overall.activeUsers).toBe(2);
    expect(metrics.users.productUsage.bySource.web.activeUsers).toBe(2);
    expect(metrics.users.productUsage.overall.visits).toBe(2);
    expect(metrics.users.productUsage.series.at(-1)?.activeUsers).toBe(1);
  });

  it("does not count activity belonging to users that are no longer registered", async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(U3),
      env.DB.prepare(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
         VALUES ('rt_deleted', 'usr_deleted_a', 'hash-deleted', ?, ?)`,
      ).bind(NOW + DAY, NOW - HOUR),
      env.DB.prepare(
        `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
         VALUES ('ae_deleted_a', 'web.page_viewed', 'usr_deleted_a', 'web', ?)`,
      ).bind(NOW - HOUR),
      env.DB.prepare(
        `INSERT INTO activity_events (id, type, user_id, source, occurred_at)
         VALUES ('ae_deleted_b', 'web.page_viewed', 'usr_deleted_b', 'web', ?)`,
      ).bind(NOW - HOUR),
    ]);

    const metrics = await loadMetrics(env.DB, NOW, 7);
    // Without joining activity back to users this fixture reports the real-world
    // contradiction: 4 active IDs despite only 3 currently registered accounts.
    expect(metrics.users.registered).toBe(3);
    expect(metrics.users.active7d).toBe(2);
    expect(metrics.users.active7d).toBeLessThanOrEqual(metrics.users.registered);
    if ("unavailable" in metrics.users.productUsage) throw new Error("activity migration unexpectedly missing");
    expect(metrics.users.productUsage.overall.activeUsers).toBe(2);
    expect(metrics.users.productUsage.bySource.web.activeUsers).toBe(2);
  });

  it("survives an empty database", async () => {
    await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
    const metrics = await loadMetrics(env.DB, NOW, 7);
    expect(metrics.users).toMatchObject({ registered: 0, newInRange: 0, active7d: 0, danger: 0 });
    expect(metrics.users.productUsage).toMatchObject({
      overall: { dau: 0, wau: 0, mau: 0, dauMau: null, activeUsers: 0, visits: 0, visitsPerActiveUser: null },
    });
    expect(metrics.tests).toMatchObject({ total: 0, perUser: null, failed2h: 0 });
    expect(metrics.tests.spendCents).toEqual({ today: 0, last7d: 0, last30d: 0 });
    expect(metrics.uptime).toMatchObject({ upPercent: null, monitorsDown: 0, monitorsTotal: 0 });
    expect(metrics.uptime.series).toHaveLength(7);
  });

  it("degrades product usage while the activity_events migration is pending", async () => {
    await env.DB.exec("DROP TABLE activity_events");
    try {
      const metrics = await loadMetrics(env.DB, NOW, 7);
      expect(metrics.users.productUsage).toEqual({ unavailable: "MIGRATION_PENDING" });
      // The pre-existing users hero still falls back to refresh-token signals.
      expect(metrics.users.active7d).toBe(1);
    } finally {
      await env.DB.batch(ACTIVITY_DDL.map((sql) => env.DB.prepare(sql)));
    }
  });
});

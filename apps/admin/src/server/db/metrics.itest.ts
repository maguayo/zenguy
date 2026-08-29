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
  });

  it("computes the tests hero with retries and estimated spend", async () => {
    const metrics = await loadMetrics(env.DB, NOW, 7);
    expect(metrics.tests.total).toBe(5); // r1-r4 + r6; r5 is outside the range
    expect(metrics.tests.perUser).toBeCloseTo(2.5); // 5 runs ÷ owners {U1, U4}
    expect(metrics.tests.failed2h).toBe(1); // r4 TIMEOUT 1h ago; r6 is 3h old
    expect(metrics.tests.retries).toEqual({ first: 1, second: 1, thirdPlus: 0 });
    // qwen is priced at 0; luna: r4 200k in = 25¢ today; +r3 1M in + 100k out = 225¢;
    // r5 (10d ago) adds 400k in = 50¢ only to the 30d window.
    expect(metrics.tests.spendCents).toEqual({ today: 25, last7d: 250, last30d: 300 });
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
  });

  it("survives an empty database", async () => {
    await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
    const metrics = await loadMetrics(env.DB, NOW, 7);
    expect(metrics.users).toMatchObject({ registered: 0, newInRange: 0, active7d: 0, danger: 0 });
    expect(metrics.tests).toMatchObject({ total: 0, perUser: null, failed2h: 0 });
    expect(metrics.tests.spendCents).toEqual({ today: 0, last7d: 0, last30d: 0 });
    expect(metrics.uptime).toMatchObject({ upPercent: null, monitorsDown: 0, monitorsTotal: 0 });
    expect(metrics.uptime.series).toHaveLength(7);
  });
});

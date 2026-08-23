import { env } from "cloudflare:test";
import { loadOverview } from "./overview";
import { loadRecentRuns } from "./runs";
import { loadUsers } from "./users";
import { loadWorkers } from "./workers";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const TABLES = [
  "uptime_checks",
  "uptime_monitors",
  "test_attempts",
  "test_runs",
  "browser_tests",
  "workspace_members",
  "workspaces",
  "refresh_tokens",
  "users",
  "runner_workers",
] as const;

const ATTEMPT_COLUMNS: Record<string, string> = {
  // 0023
  claimed_by_runner_id: "ALTER TABLE test_attempts ADD COLUMN claimed_by_runner_id TEXT",
  // 0021
  runner_kind:
    "ALTER TABLE test_attempts ADD COLUMN runner_kind TEXT " +
    "CHECK (runner_kind IN ('primary','fallback'))",
};

/** Re-creates whatever a MIGRATION_PENDING test dropped (0021 / 0023). */
async function restoreRunnerSchema(): Promise<void> {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS runner_workers (" +
      "id TEXT PRIMARY KEY, " +
      "mode TEXT NOT NULL CHECK (mode IN ('local','fallback')), " +
      "version TEXT NOT NULL, started_at INTEGER NOT NULL, " +
      "first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)",
  );
  const columns = await env.DB.prepare(
    "SELECT name FROM pragma_table_info('test_attempts')",
  ).all<{ name: string }>();
  const present = new Set(columns.results.map((column) => column.name));
  for (const [column, statement] of Object.entries(ATTEMPT_COLUMNS)) {
    if (!present.has(column)) await env.DB.exec(statement);
  }
}

async function seed(): Promise<void> {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, name, email, password_hash, email_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind("usr_one", "One", "one@example.com", "hash", NOW - 2 * DAY, NOW - 2 * DAY, NOW),
    env.DB.prepare(
      `INSERT INTO users (id, name, email, password_hash, email_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind("usr_two", "Two", "two@example.com", "hash", null, NOW - 30 * DAY, NOW),
    env.DB.prepare(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind("rt_one", "usr_one", "token-hash", NOW + 30 * DAY, NOW - HOUR),
    env.DB.prepare(
      `INSERT INTO workspaces (id, name, slug, timezone, owner_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind("ws_acme", "Acme", "acme", "UTC", "usr_one", NOW - 2 * DAY, NOW),
    // Soft-deleted: it must not inflate workspaces.total nor workspaceCount.
    env.DB.prepare(
      `INSERT INTO workspaces (id, name, slug, timezone, owner_user_id, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind("ws_gone", "Former", "former", "UTC", "usr_one", NOW - 40 * DAY, NOW, NOW - DAY),
    env.DB.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind("wm_one", "ws_acme", "usr_one", "OWNER", NOW - 2 * DAY),
    env.DB.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind("wm_gone", "ws_gone", "usr_one", "OWNER", NOW - 40 * DAY),
    env.DB.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, joined_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind("wm_two", "ws_acme", "usr_two", "MEMBER", NOW - 2 * DAY),
    env.DB.prepare(
      `INSERT INTO browser_tests
         (id, workspace_id, name, start_url, instructions, device, interval_hours,
          max_retries, next_run_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "bt_home",
      "ws_acme",
      "Homepage",
      "https://acme.test",
      "Open the homepage",
      "DESKTOP",
      1,
      1,
      NOW + 30 * MINUTE,
      NOW - 2 * DAY,
      NOW,
      null,
    ),
    env.DB.prepare(
      `INSERT INTO browser_tests
         (id, workspace_id, name, start_url, instructions, device, interval_hours,
          max_retries, next_run_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "bt_gone",
      "ws_acme",
      "Checkout",
      "https://acme.test/checkout",
      "Buy something",
      "MOBILE",
      6,
      0,
      NOW + 10 * MINUTE,
      NOW - 2 * DAY,
      NOW,
      NOW - DAY,
    ),
    env.DB.prepare(
      `INSERT INTO test_runs
         (id, workspace_id, browser_test_id, source, status, snapshot_json, queued_at,
          started_at, finished_at, duration_ms, attempt_count, passed_after_retry, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "run_pass",
      "ws_acme",
      "bt_home",
      "SCHEDULED",
      "PASSED",
      JSON.stringify({ name: "Homepage" }),
      NOW - 31 * MINUTE,
      NOW - 31 * MINUTE,
      NOW - 30 * MINUTE,
      60_000,
      1,
      0,
      NOW - 30 * MINUTE,
    ),
    env.DB.prepare(
      `INSERT INTO test_runs
         (id, workspace_id, browser_test_id, source, status, snapshot_json, queued_at,
          started_at, finished_at, duration_ms, attempt_count, passed_after_retry, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "run_fail",
      "ws_acme",
      "bt_home",
      "SCHEDULED",
      "FAILED",
      JSON.stringify({ name: "Homepage" }),
      NOW - 5 * HOUR,
      NOW - 5 * HOUR,
      NOW - 5 * HOUR + 45_000,
      45_000,
      1,
      0,
      NOW - 5 * HOUR,
    ),
    // Older than every window on purpose: it must not show up in the past
    // buckets, but it is the in-flight attempt the workers view reports.
    env.DB.prepare(
      `INSERT INTO test_runs
         (id, workspace_id, browser_test_id, source, status, snapshot_json, queued_at,
          attempt_count, passed_after_retry, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "run_running",
      "ws_acme",
      "bt_home",
      "MANUAL",
      "RUNNING",
      JSON.stringify({ name: "Homepage" }),
      NOW - 30 * HOUR,
      1,
      0,
      NOW - 30 * HOUR,
    ),
    env.DB.prepare(
      `INSERT INTO test_attempts
         (id, test_run_id, attempt_index, status, queued_at, started_at, finished_at,
          duration_ms, claimed_by_runner_id, runner_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "att_pass",
      "run_pass",
      0,
      "PASSED",
      NOW - 31 * MINUTE,
      NOW - 31 * MINUTE,
      NOW - 30 * MINUTE,
      60_000,
      null,
      null,
      NOW - 31 * MINUTE,
    ),
    env.DB.prepare(
      `INSERT INTO test_attempts
         (id, test_run_id, attempt_index, status, queued_at, started_at, finished_at,
          duration_ms, claimed_by_runner_id, runner_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "att_fail",
      "run_fail",
      0,
      "FAILED",
      NOW - 5 * HOUR,
      NOW - 5 * HOUR,
      NOW - 5 * HOUR + 45_000,
      45_000,
      "vps-1",
      "fallback",
      NOW - 5 * HOUR,
    ),
    env.DB.prepare(
      `INSERT INTO test_attempts
         (id, test_run_id, attempt_index, status, queued_at, started_at,
          claimed_by_runner_id, runner_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "att_running",
      "run_running",
      0,
      "RUNNING",
      NOW - 30 * HOUR,
      NOW - 29 * HOUR,
      "vps-1",
      "primary",
      NOW - 30 * HOUR,
    ),
    env.DB.prepare(
      `INSERT INTO uptime_monitors
         (id, workspace_id, name, url, method, frequency_seconds, next_check_at,
          current_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "mon_api",
      "ws_acme",
      "API",
      "https://acme.test/health",
      "GET",
      300,
      NOW + MINUTE,
      "UP",
      NOW - 2 * DAY,
      NOW,
    ),
    env.DB.prepare(
      `INSERT INTO uptime_checks
         (id, workspace_id, uptime_monitor_id, cycle_id, attempt_index, status,
          http_status, response_time_ms, checked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "chk_ok",
      "ws_acme",
      "mon_api",
      "cyc_ok",
      0,
      "PASSED",
      200,
      120,
      NOW - 10 * MINUTE,
      NOW - 10 * MINUTE,
    ),
    env.DB.prepare(
      `INSERT INTO uptime_checks
         (id, workspace_id, uptime_monitor_id, cycle_id, attempt_index, status,
          http_status, response_time_ms, checked_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "chk_bad",
      "ws_acme",
      "mon_api",
      "cyc_bad",
      0,
      "FAILED",
      500,
      null,
      NOW - 2 * HOUR,
      NOW - 2 * HOUR,
    ),
    env.DB.prepare(
      `INSERT INTO runner_workers (id, mode, version, started_at, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind("vps-1", "fallback", "1.2.0", NOW - HOUR, NOW - HOUR, NOW - 3_000),
    env.DB.prepare(
      `INSERT INTO runner_workers (id, mode, version, started_at, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind("mac-1", "local", "1.1.0", NOW - 2 * HOUR, NOW - 2 * HOUR, NOW - 60_000),
  ]);
}

describe("admin D1 queries", () => {
  beforeEach(seed);
  afterEach(restoreRunnerSchema);

  it("summarises the platform in one overview payload", async () => {
    const overview = await loadOverview(env.DB, NOW);

    expect(overview.users).toEqual({ total: 2, verified: 1, newLast7d: 1 });
    expect(overview.workspaces.total).toBe(1);
    expect(overview.browserTests.active).toBe(1);
    expect(overview.uptimeMonitors).toEqual({ total: 1, up: 1, down: 0, unknown: 0 });

    expect(overview.browserRuns.past.h1).toEqual({
      total: 1,
      byStatus: { PASSED: 1 },
      passRate: 1,
      avgDurationMs: 60_000,
    });
    expect(overview.browserRuns.past.h24.total).toBe(2);
    expect(overview.browserRuns.past.h24.passRate).toBe(0.5);
    expect(overview.browserRuns.past.h24.byStatus).toEqual({ PASSED: 1, FAILED: 1 });
    expect(overview.browserRuns.upcoming).toEqual({ h1: 1, h3: 3, h24: 24 });

    expect(overview.uptimeChecks.past.h1).toEqual({
      total: 1,
      up: 1,
      down: 0,
      avgResponseMs: 120,
    });
    expect(overview.uptimeChecks.past.h24).toEqual({
      total: 2,
      up: 1,
      down: 1,
      avgResponseMs: 120,
    });
    expect(overview.uptimeChecks.upcoming).toEqual({ h1: 12, h3: 36, h24: 288 });
  });

  it("buckets every window out of the single 24h scan", async () => {
    await env.DB.prepare(
      `INSERT INTO test_runs
         (id, workspace_id, browser_test_id, source, status, snapshot_json, queued_at,
          started_at, finished_at, duration_ms, attempt_count, passed_after_retry, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "run_two_hours",
        "ws_acme",
        "bt_home",
        "SCHEDULED",
        "TIMEOUT",
        JSON.stringify({ name: "Homepage" }),
        NOW - 2 * HOUR,
        NOW - 2 * HOUR,
        NOW - 2 * HOUR + 30_000,
        30_000,
        1,
        0,
        NOW - 2 * HOUR,
      )
      .run();

    const overview = await loadOverview(env.DB, NOW);

    // A two hour old run belongs to h3 and h24, never to h1.
    expect(overview.browserRuns.past.h1.byStatus).toEqual({ PASSED: 1 });
    expect(overview.browserRuns.past.h3).toEqual({
      total: 2,
      byStatus: { PASSED: 1, TIMEOUT: 1 },
      passRate: 0.5,
      avgDurationMs: 45_000,
    });
    expect(overview.browserRuns.past.h24.byStatus).toEqual({
      PASSED: 1,
      FAILED: 1,
      TIMEOUT: 1,
    });
    // chk_bad is two hours old too, and buckets the same way.
    expect(overview.uptimeChecks.past.h1.down).toBe(0);
    expect(overview.uptimeChecks.past.h3).toEqual({
      total: 2,
      up: 1,
      down: 1,
      avgResponseMs: 120,
    });
  });

  it("reports empty windows instead of dividing by zero", async () => {
    await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
    const overview = await loadOverview(env.DB, NOW);

    expect(overview.users).toEqual({ total: 0, verified: 0, newLast7d: 0 });
    expect(overview.uptimeMonitors).toEqual({ total: 0, up: 0, down: 0, unknown: 0 });
    expect(overview.browserRuns.past.h24).toEqual({
      total: 0,
      byStatus: {},
      passRate: null,
      avgDurationMs: null,
    });
    expect(overview.uptimeChecks.past.h24).toEqual({
      total: 0,
      up: 0,
      down: 0,
      avgResponseMs: null,
    });
    expect(overview.browserRuns.upcoming).toEqual({ h1: 0, h3: 0, h24: 0 });
  });

  it("marks workers online by their last heartbeat and shows the attempt in flight", async () => {
    const workers = await loadWorkers(env.DB, NOW);
    if ("unavailable" in workers) throw new Error("expected the workers payload");

    expect(workers.now).toBe(NOW);
    expect(workers.workers.map((worker) => worker.id)).toEqual(["vps-1", "mac-1"]);
    expect(workers.workers[0]).toEqual({
      id: "vps-1",
      mode: "fallback",
      version: "1.2.0",
      startedAt: NOW - HOUR,
      firstSeenAt: NOW - HOUR,
      lastSeenAt: NOW - 3_000,
      online: true,
      currentAttempt: {
        attemptId: "att_running",
        runId: "run_running",
        testName: "Homepage",
        workspaceName: "Acme",
        startedAt: NOW - 29 * HOUR,
      },
    });
    expect(workers.workers[1]).toMatchObject({
      id: "mac-1",
      mode: "local",
      online: false,
      currentAttempt: null,
    });
  });

  it("lists users by last activity, counting only live workspaces", async () => {
    const users = await loadUsers(env.DB, 50);

    expect(users.map((user) => user.email)).toEqual(["one@example.com", "two@example.com"]);
    expect(users[0]).toEqual({
      id: "usr_one",
      email: "one@example.com",
      name: "One",
      createdAt: NOW - 2 * DAY,
      emailVerified: true,
      // Two membership rows, but ws_gone is soft deleted.
      workspaceCount: 1,
      lastActiveAt: NOW - HOUR,
    });
    expect(users[1]).toMatchObject({ emailVerified: false, lastActiveAt: null });
    expect(Object.keys(users[0] ?? {})).not.toContain("passwordHash");
  });

  it("lists recent runs newest first with the worker that executed them", async () => {
    const runs = await loadRecentRuns(env.DB, 50);

    expect(runs.map((run) => run.id)).toEqual(["run_pass", "run_fail", "run_running"]);
    expect(runs[0]).toEqual({
      id: "run_pass",
      createdAt: NOW - 30 * MINUTE,
      workspaceName: "Acme",
      testName: "Homepage",
      source: "SCHEDULED",
      status: "PASSED",
      durationMs: 60_000,
      attemptCount: 1,
      passedAfterRetry: false,
      runnerId: null,
      runnerKind: null,
    });
    expect(runs[1]).toMatchObject({ runnerId: "vps-1", runnerKind: "fallback" });
  });

  it("honours the limit", async () => {
    await expect(loadUsers(env.DB, 1)).resolves.toHaveLength(1);
    await expect(loadRecentRuns(env.DB, 2)).resolves.toHaveLength(2);
  });

  it("degrades to MIGRATION_PENDING while 0023 has not reached the database", async () => {
    await env.DB.exec("DROP TABLE runner_workers");
    await env.DB.exec("ALTER TABLE test_attempts DROP COLUMN claimed_by_runner_id");

    await expect(loadWorkers(env.DB, NOW)).resolves.toEqual({
      unavailable: "MIGRATION_PENDING",
    });

    const runs = await loadRecentRuns(env.DB, 50);
    expect(runs).toHaveLength(3);
    expect(runs[0]).toMatchObject({
      id: "run_pass",
      status: "PASSED",
      runnerId: "MIGRATION_PENDING",
      runnerKind: null,
    });
    expect(runs[1]).toMatchObject({ runnerId: "MIGRATION_PENDING", runnerKind: "fallback" });

    const overview = await loadOverview(env.DB, NOW);
    expect(overview.users.total).toBe(2);
    expect(overview.browserRuns.past.h24.total).toBe(2);
    await expect(loadUsers(env.DB, 50)).resolves.toHaveLength(2);
  });

  it("still lists runs on a database that also predates runner_kind (0021)", async () => {
    await env.DB.exec("DROP TABLE runner_workers");
    await env.DB.exec("ALTER TABLE test_attempts DROP COLUMN claimed_by_runner_id");
    await env.DB.exec("ALTER TABLE test_attempts DROP COLUMN runner_kind");

    const runs = await loadRecentRuns(env.DB, 50);
    expect(runs.map((run) => run.id)).toEqual(["run_pass", "run_fail", "run_running"]);
    for (const run of runs) {
      expect(run.runnerId).toBe("MIGRATION_PENDING");
      expect(run.runnerKind).toBeNull();
    }
    expect(runs[1]).toMatchObject({ status: "FAILED", testName: "Homepage", workspaceName: "Acme" });

    await expect(loadWorkers(env.DB, NOW)).resolves.toEqual({
      unavailable: "MIGRATION_PENDING",
    });
    await expect(loadUsers(env.DB, 50)).resolves.toHaveLength(2);
  });
});

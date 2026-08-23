import { env } from "cloudflare:test";
import { loadAnalytics } from "./analytics";
import type { ChannelType, DayPoint } from "../../shared/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Midday UTC on purpose: the day buckets must key off the UTC calendar day, not
// off `now` minus a multiple of 24 h.
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);
const TODAY = Math.floor(NOW / DAY) * DAY;

/** Absolute timestamp `dayOffset` days from today at `hours` UTC. */
function at(dayOffset: number, hours = 0): number {
  return TODAY + dayOffset * DAY + hours * HOUR;
}

function dayKey(dayOffset: number): string {
  return new Date(TODAY + dayOffset * DAY).toISOString().slice(0, 10);
}

function onDay<T extends DayPoint>(series: T[], dayOffset: number): T {
  const point = series.find((entry) => entry.day === dayKey(dayOffset));
  if (point === undefined) throw new Error(`no point for day ${dayKey(dayOffset)}`);
  return point;
}

function channels(counts: Partial<Record<ChannelType, number>>): Record<ChannelType, number> {
  return {
    EMAIL: 0,
    SMS: 0,
    WHATSAPP: 0,
    CALL: 0,
    SLACK: 0,
    DISCORD: 0,
    PUSH: 0,
    ...counts,
  };
}

const TABLES = [
  "uptime_checks",
  "uptime_monitors",
  "test_attempts",
  "test_runs",
  "browser_tests",
  "incidents",
  "notification_deliveries",
  "notification_channels",
  "alert_credit_entries",
  "subscriptions",
  "workspace_members",
  "workspaces",
  "refresh_tokens",
  "users",
  "runner_workers",
] as const;

/** Explicit column list per row, so every NOT NULL column stays visible here. */
function insert(table: string, row: Record<string, unknown>): D1PreparedStatement {
  const columns = Object.keys(row);
  return env.DB.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  ).bind(...columns.map((column) => row[column]));
}

function user(id: string, createdAt: number): D1PreparedStatement {
  return insert("users", {
    id,
    name: id,
    email: `${id}@example.com`,
    password_hash: "hash",
    email_verified_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

function token(id: string, userId: string, createdAt: number): D1PreparedStatement {
  return insert("refresh_tokens", {
    id,
    user_id: userId,
    token_hash: `${id}-hash`,
    expires_at: createdAt + 30 * DAY,
    created_at: createdAt,
  });
}

function workspace(id: string, name: string, deletedAt: number | null): D1PreparedStatement {
  return insert("workspaces", {
    id,
    name,
    slug: id,
    timezone: "UTC",
    owner_user_id: "usr_a",
    created_at: at(-10),
    updated_at: at(-10),
    deleted_at: deletedAt,
  });
}

function browserTest(id: string, workspaceId: string, name: string): D1PreparedStatement {
  return insert("browser_tests", {
    id,
    workspace_id: workspaceId,
    name,
    start_url: "https://example.test",
    instructions: "Open the homepage",
    device: "DESKTOP",
    interval_hours: 1,
    max_retries: 1,
    next_run_at: NOW + HOUR,
    created_at: at(-10),
    updated_at: at(-10),
  });
}

interface RunSeed {
  id: string;
  workspaceId: string;
  testId: string | null;
  status: string;
  createdAt: number;
  durationMs: number | null;
}

function run(seed: RunSeed): D1PreparedStatement {
  return insert("test_runs", {
    id: seed.id,
    workspace_id: seed.workspaceId,
    browser_test_id: seed.testId,
    source: seed.testId === null ? "VALIDATION" : "SCHEDULED",
    status: seed.status,
    snapshot_json: JSON.stringify({ name: seed.testId ?? "validation" }),
    queued_at: seed.createdAt,
    started_at: seed.durationMs === null ? null : seed.createdAt,
    finished_at: seed.durationMs === null ? null : seed.createdAt + seed.durationMs,
    duration_ms: seed.durationMs,
    attempt_count: 1,
    passed_after_retry: 0,
    created_at: seed.createdAt,
  });
}

interface AttemptSeed {
  id: string;
  runId: string;
  index: number;
  status: string;
  createdAt: number;
  inputTokens: number | null;
  outputTokens: number | null;
  runnerKind: string | null;
}

function attempt(seed: AttemptSeed): D1PreparedStatement {
  return insert("test_attempts", {
    id: seed.id,
    test_run_id: seed.runId,
    attempt_index: seed.index,
    status: seed.status,
    queued_at: seed.createdAt,
    started_at: seed.createdAt,
    finished_at: seed.createdAt + 1_000,
    duration_ms: 1_000,
    input_tokens: seed.inputTokens,
    output_tokens: seed.outputTokens,
    runner_kind: seed.runnerKind,
    created_at: seed.createdAt,
  });
}

function check(
  id: string,
  monitorId: string,
  status: string,
  responseMs: number | null,
  checkedAt: number,
): D1PreparedStatement {
  return insert("uptime_checks", {
    id,
    workspace_id: "ws_acme",
    uptime_monitor_id: monitorId,
    cycle_id: `cyc_${id}`,
    attempt_index: 0,
    status,
    http_status: status === "PASSED" ? 200 : 500,
    response_time_ms: responseMs,
    checked_at: checkedAt,
    created_at: checkedAt,
  });
}

function delivery(
  id: string,
  channelId: string,
  status: string,
  costCents: number | null,
  createdAt: number,
): D1PreparedStatement {
  return insert("notification_deliveries", {
    id,
    workspace_id: "ws_acme",
    incident_id: null,
    notification_channel_id: channelId,
    event_type: "FAILURE",
    status,
    attempt_count: 1,
    cost_cents: costCents,
    created_at: createdAt,
  });
}

/** Columns a MIGRATION_PENDING test drops; 0021 in this file. */
const ATTEMPT_COLUMNS: Record<string, string> = {
  input_tokens: "ALTER TABLE test_attempts ADD COLUMN input_tokens INTEGER",
  output_tokens: "ALTER TABLE test_attempts ADD COLUMN output_tokens INTEGER",
  runner_kind:
    "ALTER TABLE test_attempts ADD COLUMN runner_kind TEXT " +
    "CHECK (runner_kind IN ('primary','fallback'))",
};

/** The database outlives this file, so put back whatever a test dropped. */
async function restoreAttemptSchema(): Promise<void> {
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
    // usr_old predates the range: it is the `cumulative` base, never a signup.
    user("usr_old", at(-10, 3)),
    user("usr_a", at(-3, 4)),
    user("usr_b", at(-1, 5)),
    user("usr_c", at(0, 6)),
    token("rt_old", "usr_old", at(-1, 2)),
    token("rt_a", "usr_a", at(0, 3)),
    token("rt_b", "usr_b", at(0, 4)),
    // Same user twice on the same day: DAU counts distinct users, not tokens.
    token("rt_a2", "usr_a", at(0, 5)),
    workspace("ws_acme", "Acme", null),
    workspace("ws_beta", "Beta", null),
    workspace("ws_gone", "Former", at(-2)),
    insert("workspace_members", {
      id: "wm_a",
      workspace_id: "ws_acme",
      user_id: "usr_a",
      role: "OWNER",
      joined_at: at(-10),
    }),
    insert("subscriptions", {
      id: "sub_acme",
      workspace_id: "ws_acme",
      provider: "paddle",
      source: "paddle",
      status: "ACTIVE",
      created_at: at(-10),
      updated_at: at(-10),
    }),
    insert("subscriptions", {
      id: "sub_beta",
      workspace_id: "ws_beta",
      provider: "internal",
      source: "free",
      status: "ACTIVE",
      created_at: at(-10),
      updated_at: at(-10),
    }),
    // On a deleted workspace: it must not inflate the paying count.
    insert("subscriptions", {
      id: "sub_gone",
      workspace_id: "ws_gone",
      provider: "paddle",
      source: "paddle",
      status: "ACTIVE",
      created_at: at(-10),
      updated_at: at(-10),
    }),
    browserTest("bt_home", "ws_acme", "Homepage"),
    browserTest("bt_check", "ws_acme", "Checkout"),
    browserTest("bt_beta", "ws_beta", "Beta signup"),
    browserTest("bt_slow", "ws_beta", "Beta report"),
    run({
      id: "run_p1",
      workspaceId: "ws_acme",
      testId: "bt_home",
      status: "PASSED",
      createdAt: at(0, 1),
      durationMs: 60_000,
    }),
    run({
      id: "run_f1",
      workspaceId: "ws_acme",
      testId: "bt_home",
      status: "FAILED",
      createdAt: at(0, 2),
      durationMs: 40_000,
    }),
    run({
      id: "run_t1",
      workspaceId: "ws_acme",
      testId: "bt_check",
      status: "TIMEOUT",
      createdAt: at(0, 3),
      durationMs: 120_000,
    }),
    // QUEUED: counted in `total` but in none of the four status buckets.
    run({
      id: "run_q1",
      workspaceId: "ws_acme",
      testId: "bt_home",
      status: "QUEUED",
      createdAt: at(0, 4),
      durationMs: null,
    }),
    run({
      id: "run_s1",
      workspaceId: "ws_beta",
      testId: "bt_beta",
      status: "SYSTEM_ERROR",
      createdAt: at(-1, 6),
      durationMs: 5_000,
    }),
    run({
      id: "run_p2",
      workspaceId: "ws_acme",
      testId: "bt_home",
      status: "PASSED",
      createdAt: at(-1, 7),
      durationMs: 80_000,
    }),
    run({
      id: "run_slow1",
      workspaceId: "ws_beta",
      testId: "bt_slow",
      status: "PASSED",
      createdAt: at(-2, 1),
      durationMs: 200_000,
    }),
    run({
      id: "run_slow2",
      workspaceId: "ws_beta",
      testId: "bt_slow",
      status: "PASSED",
      createdAt: at(-2, 2),
      durationMs: 210_000,
    }),
    run({
      id: "run_slow3",
      workspaceId: "ws_beta",
      testId: "bt_slow",
      status: "PASSED",
      createdAt: at(-2, 3),
      durationMs: 220_000,
    }),
    run({
      id: "run_p3",
      workspaceId: "ws_acme",
      testId: "bt_check",
      status: "PASSED",
      createdAt: at(-3, 5),
      durationMs: 100_000,
    }),
    // Ten days old: inside the 30 d workspace window, outside every 7 d series.
    run({
      id: "run_old",
      workspaceId: "ws_acme",
      testId: "bt_home",
      status: "PASSED",
      createdAt: at(-10, 1),
      durationMs: 999_999,
    }),
    run({
      id: "run_gone",
      workspaceId: "ws_gone",
      testId: null,
      status: "PASSED",
      createdAt: at(-10, 2),
      durationMs: 1_000,
    }),
    attempt({
      id: "att_p1",
      runId: "run_p1",
      index: 0,
      status: "PASSED",
      createdAt: at(0, 1),
      inputTokens: 100,
      outputTokens: 50,
      runnerKind: "primary",
    }),
    attempt({
      id: "att_f1a",
      runId: "run_f1",
      index: 0,
      status: "FAILED",
      createdAt: at(0, 2),
      inputTokens: 200,
      outputTokens: 100,
      runnerKind: "primary",
    }),
    // Last attempt of run_f1: the run counts as a fallback run.
    attempt({
      id: "att_f1b",
      runId: "run_f1",
      index: 1,
      status: "FAILED",
      createdAt: at(0, 2),
      inputTokens: 300,
      outputTokens: 150,
      runnerKind: "fallback",
    }),
    attempt({
      id: "att_t1",
      runId: "run_t1",
      index: 0,
      status: "TIMEOUT",
      createdAt: at(0, 3),
      inputTokens: 10,
      outputTokens: 5,
      runnerKind: "fallback",
    }),
    attempt({
      id: "att_s1",
      runId: "run_s1",
      index: 0,
      status: "SYSTEM_ERROR",
      createdAt: at(-1, 6),
      inputTokens: 7,
      outputTokens: 3,
      runnerKind: "primary",
    }),
    attempt({
      id: "att_p2",
      runId: "run_p2",
      index: 0,
      status: "PASSED",
      createdAt: at(-1, 7),
      inputTokens: 1,
      outputTokens: 2,
      runnerKind: null,
    }),
    attempt({
      id: "att_p3",
      runId: "run_p3",
      index: 0,
      status: "PASSED",
      createdAt: at(-3, 5),
      inputTokens: null,
      outputTokens: null,
      runnerKind: "fallback",
    }),
    attempt({
      id: "att_old",
      runId: "run_old",
      index: 0,
      status: "PASSED",
      createdAt: at(-10, 1),
      inputTokens: 9_999,
      outputTokens: 9_999,
      runnerKind: "primary",
    }),
    insert("uptime_monitors", {
      id: "mon_api",
      workspace_id: "ws_acme",
      name: "API",
      url: "https://acme.test/health",
      method: "GET",
      frequency_seconds: 300,
      next_check_at: NOW + 60_000,
      current_status: "UP",
      created_at: at(-10),
      updated_at: at(-10),
    }),
    insert("uptime_monitors", {
      id: "mon_down",
      workspace_id: "ws_acme",
      name: "Checkout API",
      url: "https://acme.test/checkout",
      method: "GET",
      frequency_seconds: 300,
      next_check_at: NOW + 60_000,
      current_status: "DOWN",
      cycle_started_at: at(-1, 8),
      created_at: at(-10),
      updated_at: at(-10),
    }),
    // Soft-deleted and DOWN: excluded from monitorsDown and from the monitor count.
    insert("uptime_monitors", {
      id: "mon_gone",
      workspace_id: "ws_acme",
      name: "Retired",
      url: "https://acme.test/retired",
      method: "GET",
      frequency_seconds: 300,
      next_check_at: NOW + 60_000,
      current_status: "DOWN",
      cycle_started_at: at(-4),
      created_at: at(-10),
      updated_at: at(-10),
      deleted_at: at(-3),
    }),
    check("chk1", "mon_api", "PASSED", 120, at(0, 1)),
    check("chk2", "mon_api", "PASSED", 180, at(0, 2)),
    check("chk3", "mon_down", "FAILED", null, at(0, 3)),
    check("chk4", "mon_api", "PASSED", 200, at(-2, 4)),
    check("chk_old", "mon_api", "PASSED", 999, at(-10, 4)),
    insert("incidents", {
      id: "inc_open",
      workspace_id: "ws_acme",
      resource_type: "UPTIME_MONITOR",
      uptime_monitor_id: "mon_down",
      status: "OPEN",
      opened_at: at(-1, 8),
      last_event_at: at(-1, 8),
      created_at: at(-1, 8),
    }),
    insert("incidents", {
      id: "inc_res",
      workspace_id: "ws_acme",
      resource_type: "BROWSER_TEST",
      browser_test_id: "bt_home",
      status: "RESOLVED",
      opened_at: at(-3, 5),
      resolved_at: at(-2, 9),
      last_event_at: at(-2, 9),
      created_at: at(-3, 5),
    }),
    insert("notification_channels", {
      id: "ch_email",
      workspace_id: "ws_acme",
      name: "Team email",
      type: "EMAIL",
      encrypted_config: "cipher",
      created_at: at(-10),
      updated_at: at(-10),
    }),
    insert("notification_channels", {
      id: "ch_sms",
      workspace_id: "ws_acme",
      name: "On-call SMS",
      type: "SMS",
      encrypted_config: "cipher",
      created_at: at(-10),
      updated_at: at(-10),
    }),
    delivery("del1", "ch_email", "SENT", 0, at(0, 1)),
    delivery("del2", "ch_sms", "SENT", 7, at(0, 2)),
    // FAILED: it still costs money but never counts as a delivered alert.
    delivery("del3", "ch_sms", "FAILED", 3, at(0, 3)),
    delivery("del4", "ch_email", "SENT", null, at(-1, 4)),
    insert("alert_credit_entries", {
      id: "ace_top",
      workspace_id: "ws_acme",
      kind: "TOPUP",
      amount_cents: 2_000,
      balance_after_cents: 2_000,
      description: "Top up",
      idempotency_key: "idem_top",
      created_at: at(-1, 1),
    }),
    insert("alert_credit_entries", {
      id: "ace_charge",
      workspace_id: "ws_acme",
      kind: "CHARGE",
      amount_cents: -7,
      balance_after_cents: 1_993,
      description: "SMS",
      idempotency_key: "idem_charge",
      created_at: at(0, 2),
    }),
    insert("alert_credit_entries", {
      id: "ace_stale",
      workspace_id: "ws_acme",
      kind: "TOPUP",
      amount_cents: 5_000,
      balance_after_cents: 5_000,
      description: "Old top up",
      idempotency_key: "idem_stale",
      created_at: at(-40),
    }),
  ]);
}

describe("admin analytics queries", () => {
  beforeEach(seed);
  afterEach(restoreAttemptSchema);

  it("returns exactly `days` UTC day points per series, oldest first", async () => {
    const analytics = await loadAnalytics(env.DB, NOW, 7);

    expect(analytics.range).toEqual({
      days: 7,
      from: dayKey(-6),
      to: dayKey(0),
      now: NOW,
    });
    for (const series of [
      analytics.users,
      analytics.runs,
      analytics.checks,
      analytics.incidents,
      analytics.deliveries,
    ]) {
      expect(series).toHaveLength(7);
      expect(series.map((point) => point.day)).toEqual([
        dayKey(-6),
        dayKey(-5),
        dayKey(-4),
        dayKey(-3),
        dayKey(-2),
        dayKey(-1),
        dayKey(0),
      ]);
    }
  });

  it("counts signups, a cumulative total seeded before the range, DAU and exact WAU", async () => {
    const { users } = await loadAnalytics(env.DB, NOW, 7);

    expect(onDay(users, -6)).toEqual({
      day: dayKey(-6),
      signups: 0,
      cumulative: 1,
      dau: 0,
      wau: 0,
    });
    expect(onDay(users, -3)).toMatchObject({ signups: 1, cumulative: 2, dau: 0 });
    expect(onDay(users, -1)).toMatchObject({ signups: 1, cumulative: 3, dau: 1, wau: 1 });
    // Two distinct users signed in today although usr_a has two tokens.
    expect(onDay(users, 0)).toEqual({
      day: dayKey(0),
      signups: 1,
      cumulative: 4,
      dau: 2,
      wau: 3,
    });
  });

  it("leaves WAU null outside the trailing 14 days of a long range", async () => {
    const { users } = await loadAnalytics(env.DB, NOW, 30);

    expect(users).toHaveLength(30);
    expect(users[0]?.day).toBe(dayKey(-29));
    expect(users[0]?.wau).toBeNull();
    expect(onDay(users, -14).wau).toBeNull();
    expect(onDay(users, -13).wau).toBe(0);
    expect(onDay(users, 0).wau).toBe(3);
    // The pre-range base is unchanged: usr_old was created 10 days ago.
    expect(users[0]?.cumulative).toBe(0);
    expect(onDay(users, -10).cumulative).toBe(1);
  });

  it("splits runs by status, averages durations and adds fallback and token totals", async () => {
    const { runs } = await loadAnalytics(env.DB, NOW, 7);

    expect(onDay(runs, -5)).toEqual({
      day: dayKey(-5),
      passed: 0,
      failed: 0,
      timeout: 0,
      systemError: 0,
      total: 0,
      fallback: 0,
      avgDurationMs: null,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(onDay(runs, -3)).toEqual({
      day: dayKey(-3),
      passed: 1,
      failed: 0,
      timeout: 0,
      systemError: 0,
      total: 1,
      fallback: 1,
      avgDurationMs: 100_000,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(onDay(runs, -1)).toEqual({
      day: dayKey(-1),
      passed: 1,
      failed: 0,
      timeout: 0,
      systemError: 1,
      total: 2,
      fallback: 0,
      avgDurationMs: 42_500,
      inputTokens: 8,
      outputTokens: 5,
    });
    // run_q1 is QUEUED: it lands in `total` only, and has no duration to average.
    expect(onDay(runs, 0)).toEqual({
      day: dayKey(0),
      passed: 1,
      failed: 1,
      timeout: 1,
      systemError: 0,
      total: 4,
      fallback: 2,
      avgDurationMs: 73_333,
      inputTokens: 610,
      outputTokens: 305,
    });
  });

  it("splits checks into up and down with the average response time", async () => {
    const { checks } = await loadAnalytics(env.DB, NOW, 7);

    expect(onDay(checks, 0)).toEqual({
      day: dayKey(0),
      up: 2,
      down: 1,
      avgResponseMs: 150,
    });
    expect(onDay(checks, -2)).toEqual({
      day: dayKey(-2),
      up: 1,
      down: 0,
      avgResponseMs: 200,
    });
    expect(onDay(checks, -4)).toEqual({
      day: dayKey(-4),
      up: 0,
      down: 0,
      avgResponseMs: null,
    });
  });

  it("buckets incidents by the day they opened and the day they resolved", async () => {
    const { incidents } = await loadAnalytics(env.DB, NOW, 7);

    expect(onDay(incidents, -3)).toEqual({ day: dayKey(-3), opened: 1, resolved: 0 });
    expect(onDay(incidents, -2)).toEqual({ day: dayKey(-2), opened: 0, resolved: 1 });
    expect(onDay(incidents, -1)).toEqual({ day: dayKey(-1), opened: 1, resolved: 0 });
    expect(onDay(incidents, 0)).toEqual({ day: dayKey(0), opened: 0, resolved: 0 });
  });

  it("counts only SENT deliveries per channel but every cost of the day", async () => {
    const { deliveries } = await loadAnalytics(env.DB, NOW, 7);

    expect(onDay(deliveries, 0)).toEqual({
      day: dayKey(0),
      byChannel: channels({ EMAIL: 1, SMS: 1 }),
      costCents: 10,
    });
    expect(onDay(deliveries, -1)).toEqual({
      day: dayKey(-1),
      byChannel: channels({ EMAIL: 1 }),
      costCents: 0,
    });
    expect(onDay(deliveries, -4)).toEqual({
      day: dayKey(-4),
      byChannel: channels({}),
      costCents: 0,
    });
  });

  it("summarises the business from subscriptions, credits, incidents and sign-ins", async () => {
    const { business } = await loadAnalytics(env.DB, NOW, 7);

    expect(business).toEqual({
      payingWorkspaces: 1,
      mrrCents: 3_900,
      freeWorkspaces: 1,
      grantWorkspaces: 0,
      creditTopupsCents30d: 2_000,
      openIncidents: 1,
      activeUsers7d: 3,
      activeUsers30d: 3,
    });
  });

  it("ranks the failing tests by failures then runs over the last 7 days", async () => {
    const { topFailingTests } = await loadAnalytics(env.DB, NOW, 7);

    expect(topFailingTests.map((row) => row.testId)).toEqual([
      "bt_home",
      "bt_check",
      "bt_beta",
    ]);
    expect(topFailingTests[0]).toEqual({
      testId: "bt_home",
      name: "Homepage",
      workspaceName: "Acme",
      runs: 4,
      failed: 1,
      passRate: 2 / 3,
      avgDurationMs: 60_000,
    });
    expect(topFailingTests[2]).toMatchObject({
      testId: "bt_beta",
      workspaceName: "Beta",
      runs: 1,
      failed: 1,
      passRate: 0,
    });
  });

  it("ranks the slowest tests by average duration, ignoring thin samples", async () => {
    const { slowestTests } = await loadAnalytics(env.DB, NOW, 7);

    // bt_check (2 timed runs) and bt_beta (1 timed run) are below the 3-timed-runs floor.
    expect(slowestTests.map((row) => row.testId)).toEqual(["bt_slow", "bt_home"]);
    expect(slowestTests[0]).toEqual({
      testId: "bt_slow",
      name: "Beta report",
      workspaceName: "Beta",
      runs: 3,
      failed: 0,
      passRate: 1,
      avgDurationMs: 210_000,
    });
  });

  it("will not rank a test as slow on one timed run out of three", async () => {
    // Three finished runs, one recorded duration, and that duration is the
    // longest in the fixture: a floor on finished runs would put it first.
    await env.DB.batch([
      browserTest("bt_thin", "ws_acme", "Thin sample"),
      run({
        id: "run_thin1",
        workspaceId: "ws_acme",
        testId: "bt_thin",
        status: "PASSED",
        createdAt: at(-1, 1),
        durationMs: 900_000,
      }),
      run({
        id: "run_thin2",
        workspaceId: "ws_acme",
        testId: "bt_thin",
        status: "PASSED",
        createdAt: at(-1, 2),
        durationMs: null,
      }),
      run({
        id: "run_thin3",
        workspaceId: "ws_acme",
        testId: "bt_thin",
        status: "PASSED",
        createdAt: at(-1, 3),
        durationMs: null,
      }),
    ]);

    const { slowestTests } = await loadAnalytics(env.DB, NOW, 7);

    expect(slowestTests.map((row) => row.testId)).toEqual(["bt_slow", "bt_home"]);
  });

  it("keeps a soft deleted test on the failing board, under its own name", async () => {
    await env.DB.batch([
      browserTest("bt_dead", "ws_acme", "Retired flow"),
      env.DB.prepare("UPDATE browser_tests SET deleted_at = ? WHERE id = ?").bind(
        at(-1),
        "bt_dead",
      ),
      run({
        id: "run_dead",
        workspaceId: "ws_acme",
        testId: "bt_dead",
        status: "FAILED",
        createdAt: at(-2, 1),
        durationMs: 30_000,
      }),
    ]);

    const { topFailingTests } = await loadAnalytics(env.DB, NOW, 7);

    expect(topFailingTests.find((row) => row.testId === "bt_dead")).toMatchObject({
      name: "Retired flow",
      workspaceName: "Acme",
      failed: 1,
      runs: 1,
    });
  });

  it("falls back to the run snapshot when the test row is gone for good", async () => {
    // No browser_tests row at all: the only name left is the one the run
    // snapshotted when it was queued.
    await env.DB.batch([
      insert("test_runs", {
        id: "run_ghost",
        workspace_id: "ws_acme",
        browser_test_id: "bt_ghost",
        source: "SCHEDULED",
        status: "FAILED",
        snapshot_json: JSON.stringify({ name: "Ghost checkout" }),
        queued_at: at(-2, 2),
        started_at: at(-2, 2),
        finished_at: at(-2, 2) + 20_000,
        duration_ms: 20_000,
        attempt_count: 1,
        passed_after_retry: 0,
        created_at: at(-2, 2),
      }),
    ]);

    const { topFailingTests } = await loadAnalytics(env.DB, NOW, 7);

    expect(topFailingTests.find((row) => row.testId === "bt_ghost")).toMatchObject({
      name: "Ghost checkout",
      workspaceName: "Acme",
      failed: 1,
    });
  });

  it("lists the busiest live workspaces of the last 30 days", async () => {
    const { activeWorkspaces } = await loadAnalytics(env.DB, NOW, 7);

    expect(activeWorkspaces.map((row) => row.workspaceId)).toEqual(["ws_acme", "ws_beta"]);
    expect(activeWorkspaces[0]).toEqual({
      workspaceId: "ws_acme",
      name: "Acme",
      // Seven runs including the ten day old one, which no series covers.
      runs: 7,
      // mon_gone is soft deleted.
      monitors: 2,
      lastRunAt: at(0, 4),
      subscription: "paddle",
    });
    expect(activeWorkspaces[1]).toMatchObject({
      workspaceId: "ws_beta",
      runs: 4,
      monitors: 0,
      // run_s1, not the newest of the three bt_slow runs.
      lastRunAt: at(-1, 6),
      subscription: "free",
    });
  });

  it("lists the monitors that are down now and the incidents still open", async () => {
    const { monitorsDown, openIncidents } = await loadAnalytics(env.DB, NOW, 7);

    expect(monitorsDown).toEqual([
      {
        monitorId: "mon_down",
        name: "Checkout API",
        workspaceName: "Acme",
        since: at(-1, 8),
      },
    ]);
    expect(openIncidents).toEqual([
      {
        incidentId: "inc_open",
        resourceType: "UPTIME_MONITOR",
        resourceName: "Checkout API",
        workspaceName: "Acme",
        openedAt: at(-1, 8),
      },
    ]);
  });

  it("returns zero filled series on an empty database", async () => {
    await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
    const analytics = await loadAnalytics(env.DB, NOW, 7);

    expect(analytics.users).toHaveLength(7);
    expect(analytics.users[6]).toEqual({
      day: dayKey(0),
      signups: 0,
      cumulative: 0,
      dau: 0,
      wau: 0,
    });
    expect(analytics.runs[6]).toMatchObject({ total: 0, avgDurationMs: null, fallback: 0 });
    expect(analytics.checks[6]).toMatchObject({ up: 0, down: 0, avgResponseMs: null });
    expect(analytics.deliveries[6]).toEqual({
      day: dayKey(0),
      byChannel: channels({}),
      costCents: 0,
    });
    expect(analytics.business).toMatchObject({
      payingWorkspaces: 0,
      mrrCents: 0,
      openIncidents: 0,
      activeUsers7d: 0,
    });
    expect(analytics.topFailingTests).toEqual([]);
    expect(analytics.slowestTests).toEqual([]);
    expect(analytics.activeWorkspaces).toEqual([]);
    expect(analytics.monitorsDown).toEqual([]);
    expect(analytics.openIncidents).toEqual([]);
  });

  it("reports zero tokens and no fallback share while 0021 is missing", async () => {
    await env.DB.exec("ALTER TABLE test_attempts DROP COLUMN input_tokens");
    await env.DB.exec("ALTER TABLE test_attempts DROP COLUMN output_tokens");
    await env.DB.exec("ALTER TABLE test_attempts DROP COLUMN runner_kind");

    const { runs } = await loadAnalytics(env.DB, NOW, 7);

    expect(onDay(runs, 0)).toMatchObject({
      total: 4,
      passed: 1,
      failed: 1,
      fallback: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});

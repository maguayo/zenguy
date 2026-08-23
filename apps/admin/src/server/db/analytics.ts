import type {
  ActiveWorkspaceRow,
  Analytics,
  AnalyticsBusiness,
  ChannelType,
  ChecksDay,
  DeliveriesDay,
  IncidentsDay,
  MonitorDownRow,
  OpenIncidentRow,
  RunsDay,
  TestLeaderboardRow,
  UsersDay,
} from "../../shared/types";
import { DAY_MS, PLAN_PRICE_CENTS } from "../constants";
import { isMigrationPendingError } from "./errors";

const CHANNEL_TYPES: ChannelType[] = [
  "EMAIL",
  "SMS",
  "WHATSAPP",
  "CALL",
  "SLACK",
  "DISCORD",
  "PUSH",
];

/** Trailing windows the leaderboards and the business block are pinned to. */
const LEADERBOARD_DAYS = 7;
const WORKSPACE_DAYS = 30;
const WAU_WINDOW_DAYS = 7;
/** Exact WAU is only computed for the tail of the range; earlier days are null. */
const WAU_TAIL_DAYS = 14;
const LEADERBOARD_LIMIT = 10;
/** The busiest workspaces table is its own list; it does not follow the boards. */
const WORKSPACE_LIMIT = 10;
const LIST_LIMIT = 20;
/** A test needs this many *timed* runs before its average duration ranks. */
const SLOWEST_MIN_RUNS = 3;

const FINISHED_STATUSES = "'PASSED', 'FAILED', 'TIMEOUT', 'SYSTEM_ERROR'";

/** SQLite bucketing shared by every series: the UTC calendar day of a ms column. */
function dayExpression(column: string): string {
  return `strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`;
}

/**
 * The three statements that read test_runs over a bare date range. They are
 * named here rather than inlined so `analytics_plan.itest.ts` can EXPLAIN QUERY
 * PLAN the exact text this module executes: the `GROUP BY +column` trick below
 * is invisible to typecheck and to every other test, and losing it silently
 * turns two of them back into full-table walks.
 */
const RUNS_BY_DAY_SQL = `SELECT ${dayExpression("created_at")} AS day,
                status,
                COUNT(*) AS total,
                SUM(COALESCE(duration_ms, 0)) AS duration_sum,
                COUNT(duration_ms) AS duration_count
         FROM test_runs
         WHERE created_at >= ?1
         GROUP BY day, status`;

const TEST_LEADERBOARD_SQL = `SELECT runs.browser_test_id AS test_id,
                COALESCE(tests.name, json_extract(runs.snapshot_json, '$.name'), '') AS name,
                workspaces.name AS workspace_name,
                COUNT(*) AS total,
                SUM(CASE WHEN runs.status = 'PASSED' THEN 1 ELSE 0 END) AS passed,
                SUM(CASE WHEN runs.status IN (${FINISHED_STATUSES}) THEN 1 ELSE 0 END)
                  AS finished,
                SUM(COALESCE(runs.duration_ms, 0)) AS duration_sum,
                COUNT(runs.duration_ms) AS duration_count
         FROM test_runs AS runs
         LEFT JOIN browser_tests AS tests ON tests.id = runs.browser_test_id
         LEFT JOIN workspaces ON workspaces.id = runs.workspace_id
         WHERE runs.created_at >= ?1 AND runs.browser_test_id IS NOT NULL
         GROUP BY +runs.browser_test_id`;

const ACTIVE_WORKSPACES_SQL = `SELECT runs.workspace_id AS workspace_id,
                workspaces.name AS name,
                COUNT(*) AS run_count,
                MAX(runs.created_at) AS last_run_at,
                (SELECT COUNT(*) FROM uptime_monitors AS monitors
                  WHERE monitors.workspace_id = runs.workspace_id
                    AND monitors.deleted_at IS NULL) AS monitors,
                (SELECT subs.source FROM subscriptions AS subs
                  WHERE subs.workspace_id = runs.workspace_id) AS subscription
         FROM test_runs AS runs
         JOIN workspaces ON workspaces.id = runs.workspace_id
          AND workspaces.deleted_at IS NULL
         WHERE runs.created_at >= ?1
         GROUP BY +runs.workspace_id
         ORDER BY run_count DESC, last_run_at DESC
         LIMIT ?2`;

/**
 * Those three statements with a set of bindings that makes their plan real —
 * an unbound date range plans against NULL and can pick a different index.
 * Exported for the query-plan integration test only.
 */
export function planQueries(fromMs: number): { binds: unknown[]; name: string; sql: string }[] {
  return [
    { binds: [fromMs], name: "runs by day", sql: RUNS_BY_DAY_SQL },
    { binds: [fromMs], name: "test leaderboard", sql: TEST_LEADERBOARD_SQL },
    { binds: [fromMs, WORKSPACE_LIMIT], name: "active workspaces", sql: ACTIVE_WORKSPACES_SQL },
  ];
}

function startOfUtcDay(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function average(sum: number, count: number): number | null {
  return count === 0 ? null : Math.round(sum / count);
}

interface DayRow {
  day: string;
}

/** Rows keyed by their day bucket, so the zero fill can look each day up. */
function byDay<T extends DayRow>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.day, row]));
}

interface UsersDayRow extends DayRow {
  signups: number;
}

interface DauRow extends DayRow {
  dau: number;
}

interface WauRow extends DayRow {
  user_id: string;
}

interface RunStatusRow extends DayRow {
  status: string;
  total: number;
  duration_sum: number | null;
  duration_count: number;
}

interface RunAttemptRow extends DayRow {
  fallback: number;
  input_tokens: number;
  output_tokens: number;
}

interface CheckRow extends DayRow {
  status: string;
  total: number;
  response_sum: number | null;
  response_count: number;
}

interface IncidentDayRow extends DayRow {
  opened: number;
  resolved: number;
}

interface DeliveryRow extends DayRow {
  type: ChannelType | null;
  sent: number;
  cost_cents: number | null;
}

interface ScalarsRow {
  users_before: number;
  open_incidents: number;
  credit_topups_cents: number | null;
  active_users_7d: number;
  active_users_30d: number;
}

interface SubscriptionRow {
  paying: number | null;
  free: number | null;
  granted: number | null;
}

interface LeaderboardRow {
  test_id: string;
  name: string;
  workspace_name: string | null;
  total: number;
  passed: number;
  finished: number;
  duration_sum: number | null;
  duration_count: number;
}

interface WorkspaceRow {
  workspace_id: string;
  name: string;
  run_count: number;
  monitors: number;
  last_run_at: number | null;
  subscription: string | null;
}

interface MonitorRow {
  monitor_id: string;
  name: string;
  workspace_name: string | null;
  since: number | null;
}

interface IncidentRow {
  incident_id: string;
  resource_type: OpenIncidentRow["resourceType"];
  resource_name: string | null;
  workspace_name: string | null;
  opened_at: number;
}

/**
 * Tokens and fallback attribution live in columns added by 0021. Production is
 * well past it, so this is defence only: a database without them reports zeros
 * instead of failing the whole endpoint.
 */
async function loadRunAttempts(db: D1Database, fromMs: number): Promise<Map<string, RunAttemptRow>> {
  try {
    const { results } = await db
      .prepare(
        `SELECT ${dayExpression("runs.created_at")} AS day,
                SUM(CASE WHEN (SELECT last.runner_kind
                                 FROM test_attempts AS last
                                WHERE last.test_run_id = runs.id
                                ORDER BY last.attempt_index DESC
                                LIMIT 1) = 'fallback' THEN 1 ELSE 0 END) AS fallback,
                SUM(COALESCE((SELECT SUM(a.input_tokens) FROM test_attempts AS a
                               WHERE a.test_run_id = runs.id), 0)) AS input_tokens,
                SUM(COALESCE((SELECT SUM(a.output_tokens) FROM test_attempts AS a
                               WHERE a.test_run_id = runs.id), 0)) AS output_tokens
         FROM test_runs AS runs
         WHERE runs.created_at >= ?1
         GROUP BY day`,
      )
      .bind(fromMs)
      .all<RunAttemptRow>();
    return byDay(results);
  } catch (error) {
    if (isMigrationPendingError(error)) return new Map();
    throw error;
  }
}

function toUsersSeries(
  days: string[],
  signups: Map<string, UsersDayRow>,
  dau: Map<string, DauRow>,
  wau: Map<string, number | null>,
  usersBefore: number,
): UsersDay[] {
  let cumulative = usersBefore;
  return days.map((day) => {
    const created = signups.get(day)?.signups ?? 0;
    cumulative += created;
    return {
      day,
      signups: created,
      cumulative,
      dau: dau.get(day)?.dau ?? 0,
      wau: wau.get(day) ?? null,
    };
  });
}

/**
 * Exact WAU for the tail of the range: one query returns the (day, user) pairs
 * of the last 20 days and every trailing 7 day window is unioned in memory,
 * instead of running one COUNT(DISTINCT) per day.
 */
function toWauByDay(days: string[], pairs: WauRow[]): Map<string, number | null> {
  const usersByDay = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const users = usersByDay.get(pair.day) ?? new Set<string>();
    users.add(pair.user_id);
    usersByDay.set(pair.day, users);
  }
  const exactFrom = Math.max(0, days.length - WAU_TAIL_DAYS);
  return new Map(
    days.map((day, index) => {
      if (index < exactFrom) return [day, null];
      const window = new Set<string>();
      for (let back = 0; back < WAU_WINDOW_DAYS; back += 1) {
        const key = dayKey(Date.parse(`${day}T00:00:00Z`) - back * DAY_MS);
        for (const user of usersByDay.get(key) ?? []) window.add(user);
      }
      return [day, window.size];
    }),
  );
}

function toRunsSeries(
  days: string[],
  statusRows: RunStatusRow[],
  attempts: Map<string, RunAttemptRow>,
): RunsDay[] {
  const byDayAndStatus = new Map<string, RunStatusRow[]>();
  for (const row of statusRows) {
    byDayAndStatus.set(row.day, [...(byDayAndStatus.get(row.day) ?? []), row]);
  }
  return days.map((day) => {
    const rows = byDayAndStatus.get(day) ?? [];
    const count = (status: string) =>
      rows.find((row) => row.status === status)?.total ?? 0;
    const durationSum = rows.reduce((sum, row) => sum + (row.duration_sum ?? 0), 0);
    const durationCount = rows.reduce((sum, row) => sum + row.duration_count, 0);
    const attempt = attempts.get(day);
    return {
      day,
      passed: count("PASSED"),
      failed: count("FAILED"),
      timeout: count("TIMEOUT"),
      systemError: count("SYSTEM_ERROR"),
      total: rows.reduce((sum, row) => sum + row.total, 0),
      fallback: attempt?.fallback ?? 0,
      avgDurationMs: average(durationSum, durationCount),
      inputTokens: attempt?.input_tokens ?? 0,
      outputTokens: attempt?.output_tokens ?? 0,
    };
  });
}

function toChecksSeries(days: string[], rows: CheckRow[]): ChecksDay[] {
  const byDayKey = new Map<string, CheckRow[]>();
  for (const row of rows) {
    byDayKey.set(row.day, [...(byDayKey.get(row.day) ?? []), row]);
  }
  return days.map((day) => {
    const dayRows = byDayKey.get(day) ?? [];
    const responseSum = dayRows.reduce((sum, row) => sum + (row.response_sum ?? 0), 0);
    const responseCount = dayRows.reduce((sum, row) => sum + row.response_count, 0);
    return {
      day,
      up: dayRows.find((row) => row.status === "PASSED")?.total ?? 0,
      down: dayRows.find((row) => row.status === "FAILED")?.total ?? 0,
      avgResponseMs: average(responseSum, responseCount),
    };
  });
}

function toIncidentsSeries(days: string[], rows: IncidentDayRow[]): IncidentsDay[] {
  const byDayKey = byDay(rows);
  return days.map((day) => ({
    day,
    opened: byDayKey.get(day)?.opened ?? 0,
    resolved: byDayKey.get(day)?.resolved ?? 0,
  }));
}

function toDeliveriesSeries(days: string[], rows: DeliveryRow[]): DeliveriesDay[] {
  const byDayKey = new Map<string, DeliveryRow[]>();
  for (const row of rows) {
    byDayKey.set(row.day, [...(byDayKey.get(row.day) ?? []), row]);
  }
  return days.map((day) => {
    const dayRows = byDayKey.get(day) ?? [];
    const byChannel = Object.fromEntries(
      CHANNEL_TYPES.map((type) => [
        type,
        dayRows.find((row) => row.type === type)?.sent ?? 0,
      ]),
    ) as Record<ChannelType, number>;
    return {
      day,
      byChannel,
      costCents: dayRows.reduce((sum, row) => sum + (row.cost_cents ?? 0), 0),
    };
  });
}

function toBusiness(
  scalars: ScalarsRow | null,
  subscriptions: SubscriptionRow | null,
): AnalyticsBusiness {
  const paying = subscriptions?.paying ?? 0;
  return {
    payingWorkspaces: paying,
    mrrCents: paying * PLAN_PRICE_CENTS,
    freeWorkspaces: subscriptions?.free ?? 0,
    grantWorkspaces: subscriptions?.granted ?? 0,
    creditTopupsCents30d: scalars?.credit_topups_cents ?? 0,
    openIncidents: scalars?.open_incidents ?? 0,
    activeUsers7d: scalars?.active_users_7d ?? 0,
    activeUsers30d: scalars?.active_users_30d ?? 0,
  };
}

function toLeaderboardRow(row: LeaderboardRow): TestLeaderboardRow {
  return {
    testId: row.test_id,
    name: row.name,
    workspaceName: row.workspace_name,
    runs: row.total,
    failed: row.finished - row.passed,
    passRate: row.finished === 0 ? null : row.passed / row.finished,
    avgDurationMs: average(row.duration_sum ?? 0, row.duration_count),
  };
}

/** Failures first, then the busiest test, then the id so ties stay stable. */
function toTopFailing(rows: LeaderboardRow[]): TestLeaderboardRow[] {
  return rows
    .map(toLeaderboardRow)
    .filter((row) => row.failed > 0)
    .sort(
      (left, right) =>
        right.failed - left.failed ||
        right.runs - left.runs ||
        left.testId.localeCompare(right.testId),
    )
    .slice(0, LEADERBOARD_LIMIT);
}

/**
 * Slowest by average duration, but only where there is an average worth
 * ranking. The floor is on `duration_count`, not on finished runs: a test that
 * finished three times and recorded one duration would otherwise be ranked on a
 * single sample.
 */
function toSlowest(rows: LeaderboardRow[]): TestLeaderboardRow[] {
  return rows
    .filter((row) => row.duration_count >= SLOWEST_MIN_RUNS)
    .map(toLeaderboardRow)
    .sort(
      (left, right) =>
        (right.avgDurationMs ?? 0) - (left.avgDurationMs ?? 0) ||
        left.testId.localeCompare(right.testId),
    )
    .slice(0, LEADERBOARD_LIMIT);
}

function toActiveWorkspace(row: WorkspaceRow): ActiveWorkspaceRow {
  return {
    workspaceId: row.workspace_id,
    name: row.name,
    runs: row.run_count,
    monitors: row.monitors,
    lastRunAt: row.last_run_at,
    subscription: row.subscription ?? "none",
  };
}

/**
 * Every daily series plus the business snapshot and the four leaderboards, in
 * fourteen bounded SELECT-only statements. `days` is validated by the route
 * (7, 30 or 90); every series carries exactly `days` UTC day points, oldest
 * first, with zeros filled in memory.
 */
export async function loadAnalytics(
  db: D1Database,
  now: number,
  days: number,
): Promise<Analytics> {
  const toMs = startOfUtcDay(now);
  const fromMs = toMs - (days - 1) * DAY_MS;
  // The 7 day WAU window of the oldest exact day reaches this far back: always
  // twenty days, whatever the range, so days=90 does not pull ninety days of
  // (day, user) pairs to compute fourteen windows.
  const wauFromMs = toMs - (WAU_TAIL_DAYS + WAU_WINDOW_DAYS - 2) * DAY_MS;
  const leaderboardFromMs = now - LEADERBOARD_DAYS * DAY_MS;
  const workspaceFromMs = now - WORKSPACE_DAYS * DAY_MS;
  const dayKeys = Array.from({ length: days }, (_, index) => dayKey(fromMs + index * DAY_MS));

  // `GROUP BY +column` is deliberate in TEST_LEADERBOARD_SQL and
  // ACTIVE_WORKSPACES_SQL above: without the unary plus SQLite groups through
  // idx_runs_test_time / idx_runs_ws_time and walks every run ever recorded. It
  // keeps them on idx_test_runs_created_at (0024), the only index that honours
  // the date bound. Do not "tidy" it away — analytics_plan.itest.ts pins it.
  const [
    scalars,
    subscriptions,
    signups,
    dau,
    wauPairs,
    runStatuses,
    runAttempts,
    checks,
    incidentDays,
    deliveries,
    leaderboard,
    workspaces,
    monitorsDown,
    openIncidents,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM users WHERE created_at < ?1) AS users_before,
                (SELECT COUNT(*) FROM incidents WHERE status = 'OPEN') AS open_incidents,
                (SELECT COALESCE(SUM(amount_cents), 0) FROM alert_credit_entries
                  WHERE kind = 'TOPUP' AND created_at >= ?2) AS credit_topups_cents,
                (SELECT COUNT(DISTINCT user_id) FROM refresh_tokens
                  WHERE created_at >= ?3) AS active_users_7d,
                (SELECT COUNT(DISTINCT user_id) FROM refresh_tokens
                  WHERE created_at >= ?2) AS active_users_30d`,
      )
      .bind(fromMs, workspaceFromMs, leaderboardFromMs)
      .first<ScalarsRow>(),
    db
      .prepare(
        `SELECT SUM(CASE WHEN subs.status = 'ACTIVE' AND subs.source = 'paddle'
                         THEN 1 ELSE 0 END) AS paying,
                SUM(CASE WHEN subs.source = 'free' THEN 1 ELSE 0 END) AS free,
                SUM(CASE WHEN subs.source = 'grant' THEN 1 ELSE 0 END) AS granted
         FROM subscriptions AS subs
         JOIN workspaces ON workspaces.id = subs.workspace_id
          AND workspaces.deleted_at IS NULL`,
      )
      .first<SubscriptionRow>(),
    db
      .prepare(
        `SELECT ${dayExpression("created_at")} AS day, COUNT(*) AS signups
         FROM users
         WHERE created_at >= ?1
         GROUP BY day`,
      )
      .bind(fromMs)
      .all<UsersDayRow>(),
    db
      .prepare(
        `SELECT ${dayExpression("created_at")} AS day, COUNT(DISTINCT user_id) AS dau
         FROM refresh_tokens
         WHERE created_at >= ?1
         GROUP BY day`,
      )
      .bind(fromMs)
      .all<DauRow>(),
    db
      .prepare(
        `SELECT ${dayExpression("created_at")} AS day, user_id
         FROM refresh_tokens
         WHERE created_at >= ?1
         GROUP BY day, user_id`,
      )
      .bind(wauFromMs)
      .all<WauRow>(),
    db.prepare(RUNS_BY_DAY_SQL).bind(fromMs).all<RunStatusRow>(),
    loadRunAttempts(db, fromMs),
    db
      .prepare(
        `SELECT ${dayExpression("checked_at")} AS day,
                status,
                COUNT(*) AS total,
                SUM(COALESCE(response_time_ms, 0)) AS response_sum,
                COUNT(response_time_ms) AS response_count
         FROM uptime_checks
         WHERE checked_at >= ?1
         GROUP BY day, status`,
      )
      .bind(fromMs)
      .all<CheckRow>(),
    db
      .prepare(
        `SELECT day, SUM(opened) AS opened, SUM(resolved) AS resolved
         FROM (SELECT ${dayExpression("opened_at")} AS day, 1 AS opened, 0 AS resolved
                 FROM incidents
                WHERE opened_at >= ?1
               UNION ALL
               SELECT ${dayExpression("resolved_at")} AS day, 0 AS opened, 1 AS resolved
                 FROM incidents
                WHERE resolved_at >= ?1)
         GROUP BY day`,
      )
      .bind(fromMs)
      .all<IncidentDayRow>(),
    db
      .prepare(
        `SELECT ${dayExpression("deliveries.created_at")} AS day,
                channels.type AS type,
                SUM(CASE WHEN deliveries.status = 'SENT' THEN 1 ELSE 0 END) AS sent,
                SUM(COALESCE(deliveries.cost_cents, 0)) AS cost_cents
         FROM notification_deliveries AS deliveries
         LEFT JOIN notification_channels AS channels
           ON channels.id = deliveries.notification_channel_id
         WHERE deliveries.created_at >= ?1
         GROUP BY day, type`,
      )
      .bind(fromMs)
      .all<DeliveryRow>(),
    db.prepare(TEST_LEADERBOARD_SQL).bind(leaderboardFromMs).all<LeaderboardRow>(),
    db.prepare(ACTIVE_WORKSPACES_SQL).bind(workspaceFromMs, WORKSPACE_LIMIT).all<WorkspaceRow>(),
    db
      .prepare(
        `SELECT monitors.id AS monitor_id,
                monitors.name AS name,
                workspaces.name AS workspace_name,
                monitors.cycle_started_at AS since
         FROM uptime_monitors AS monitors
         LEFT JOIN workspaces ON workspaces.id = monitors.workspace_id
         WHERE monitors.current_status = 'DOWN' AND monitors.deleted_at IS NULL
         ORDER BY monitors.cycle_started_at IS NULL, monitors.cycle_started_at, monitors.id
         LIMIT ?1`,
      )
      .bind(LIST_LIMIT)
      .all<MonitorRow>(),
    db
      .prepare(
        `SELECT incidents.id AS incident_id,
                incidents.resource_type AS resource_type,
                incidents.opened_at AS opened_at,
                COALESCE(tests.name, monitors.name) AS resource_name,
                workspaces.name AS workspace_name
         FROM incidents
         LEFT JOIN browser_tests AS tests ON tests.id = incidents.browser_test_id
         LEFT JOIN uptime_monitors AS monitors ON monitors.id = incidents.uptime_monitor_id
         LEFT JOIN workspaces ON workspaces.id = incidents.workspace_id
         WHERE incidents.status = 'OPEN'
         ORDER BY incidents.opened_at, incidents.id
         LIMIT ?1`,
      )
      .bind(LIST_LIMIT)
      .all<IncidentRow>(),
  ]);

  return {
    range: { days, from: dayKey(fromMs), to: dayKey(toMs), now },
    users: toUsersSeries(
      dayKeys,
      byDay(signups.results),
      byDay(dau.results),
      toWauByDay(dayKeys, wauPairs.results),
      scalars?.users_before ?? 0,
    ),
    runs: toRunsSeries(dayKeys, runStatuses.results, runAttempts),
    checks: toChecksSeries(dayKeys, checks.results),
    incidents: toIncidentsSeries(dayKeys, incidentDays.results),
    deliveries: toDeliveriesSeries(dayKeys, deliveries.results),
    business: toBusiness(scalars, subscriptions),
    topFailingTests: toTopFailing(leaderboard.results),
    slowestTests: toSlowest(leaderboard.results),
    activeWorkspaces: workspaces.results.map(toActiveWorkspace),
    monitorsDown: monitorsDown.results.map(
      (row): MonitorDownRow => ({
        monitorId: row.monitor_id,
        name: row.name,
        workspaceName: row.workspace_name,
        since: row.since,
      }),
    ),
    openIncidents: openIncidents.results.map(
      (row): OpenIncidentRow => ({
        incidentId: row.incident_id,
        resourceType: row.resource_type,
        resourceName: row.resource_name,
        workspaceName: row.workspace_name,
        openedAt: row.opened_at,
      }),
    ),
  };
}

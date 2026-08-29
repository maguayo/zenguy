import type { MetricRangeDays, Metrics, TestsDayPoint, UptimeDayPoint } from "../../shared/types";
import {
  ACTIVE_WINDOW_MS,
  DANGER_WINDOW_MS,
  DAY_MS,
  DEFAULT_MODEL_PRICE,
  FAILED_RECENT_WINDOW_MS,
  MODEL_PRICES,
} from "../constants";
import { isMigrationPendingError } from "./errors";

function startOfUtcDay(timestampMs: number): number {
  return timestampMs - (timestampMs % DAY_MS);
}

function utcDayString(timestampMs: number): string {
  return new Date(startOfUtcDay(timestampMs)).toISOString().slice(0, 10);
}

/** Oldest-first list of the `days` UTC day keys ending at `now`'s day. */
function dayKeys(now: number, days: number): string[] {
  const start = startOfUtcDay(now) - (days - 1) * DAY_MS;
  return Array.from({ length: days }, (_, index) => utcDayString(start + index * DAY_MS));
}

const DAY_SQL = (column: string) => `strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`;

interface UserScalarsRow {
  registered: number;
  new_in_range: number;
  users_before: number;
  active_tokens: number;
  danger_tokens: number;
}

// Sign-ins (refresh tokens) work on every schema; activity_events (0038) may
// still be missing, so the combined signal lives in a separate degradable query.
const USER_SCALARS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM users) AS registered,
    (SELECT COUNT(*) FROM users WHERE created_at >= ?1) AS new_in_range,
    (SELECT COUNT(*) FROM users WHERE created_at < ?1) AS users_before,
    (SELECT COUNT(DISTINCT user_id) FROM refresh_tokens WHERE created_at >= ?2) AS active_tokens,
    (SELECT COUNT(*) FROM users u
      WHERE u.created_at <= ?3
        AND NOT EXISTS (
          SELECT 1 FROM refresh_tokens rt WHERE rt.user_id = u.id AND rt.created_at >= ?3
        )) AS danger_tokens`;

interface UserActivityRow {
  active_combined: number;
  danger_combined: number;
}

const USER_ACTIVITY_SQL = `
  SELECT
    (SELECT COUNT(*) FROM (
      SELECT user_id FROM refresh_tokens WHERE created_at >= ?1
      UNION
      SELECT user_id FROM activity_events WHERE occurred_at >= ?1 AND user_id IS NOT NULL
    )) AS active_combined,
    (SELECT COUNT(*) FROM users u
      WHERE u.created_at <= ?2
        AND NOT EXISTS (
          SELECT 1 FROM refresh_tokens rt WHERE rt.user_id = u.id AND rt.created_at >= ?2
        )
        AND NOT EXISTS (
          SELECT 1 FROM activity_events ae WHERE ae.user_id = u.id AND ae.occurred_at >= ?2
        )) AS danger_combined`;

interface SignupsRow {
  day: string;
  signups: number;
}

const SIGNUPS_SQL = `
  SELECT ${DAY_SQL("created_at")} AS day, COUNT(*) AS signups
    FROM users WHERE created_at >= ?1 GROUP BY day`;

interface RunsDayRow {
  day: string;
  status: string;
  total: number;
  duration_sum: number;
  duration_count: number;
}

const RUNS_BY_DAY_SQL = `
  SELECT ${DAY_SQL("created_at")} AS day, status, COUNT(*) AS total,
         SUM(COALESCE(duration_ms, 0)) AS duration_sum,
         COUNT(duration_ms) AS duration_count
    FROM test_runs WHERE created_at >= ?1 GROUP BY day, status`;

interface TestScalarsRow {
  total: number;
  owners: number;
  failed_recent: number;
}

const TEST_SCALARS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM test_runs WHERE created_at >= ?1) AS total,
    (SELECT COUNT(DISTINCT w.owner_user_id)
       FROM test_runs r JOIN workspaces w ON w.id = r.workspace_id
      WHERE r.created_at >= ?1) AS owners,
    (SELECT COUNT(*) FROM test_runs
      WHERE created_at >= ?2
        AND status IN ('FAILED','TIMEOUT','SYSTEM_ERROR')) AS failed_recent`;

interface RetriesRow {
  idx: number;
  passes: number;
}

const RETRIES_SQL = `
  SELECT a.attempt_index AS idx, COUNT(*) AS passes
    FROM test_attempts a JOIN test_runs r ON r.id = a.test_run_id
   WHERE r.created_at >= ?1 AND a.status = 'PASSED'
   GROUP BY a.attempt_index`;

interface SpendRow {
  model: string | null;
  input_today: number;
  output_today: number;
  input_7d: number;
  output_7d: number;
  input_30d: number;
  output_30d: number;
}

// Windowed with CASE so one scan covers today / 7d / 30d. Token columns are
// 0021; a lagging database degrades to zero spend instead of failing.
const SPEND_SQL = `
  SELECT a.model_name AS model,
         SUM(CASE WHEN r.created_at >= ?1 THEN COALESCE(a.input_tokens, 0) ELSE 0 END) AS input_today,
         SUM(CASE WHEN r.created_at >= ?1 THEN COALESCE(a.output_tokens, 0) ELSE 0 END) AS output_today,
         SUM(CASE WHEN r.created_at >= ?2 THEN COALESCE(a.input_tokens, 0) ELSE 0 END) AS input_7d,
         SUM(CASE WHEN r.created_at >= ?2 THEN COALESCE(a.output_tokens, 0) ELSE 0 END) AS output_7d,
         SUM(COALESCE(a.input_tokens, 0)) AS input_30d,
         SUM(COALESCE(a.output_tokens, 0)) AS output_30d
    FROM test_attempts a JOIN test_runs r ON r.id = a.test_run_id
   WHERE r.created_at >= ?3
   GROUP BY a.model_name`;

interface ChecksDayRow {
  day: string;
  status: string;
  total: number;
  response_sum: number;
  response_count: number;
}

const CHECKS_BY_DAY_SQL = `
  SELECT ${DAY_SQL("checked_at")} AS day, status, COUNT(*) AS total,
         SUM(COALESCE(response_time_ms, 0)) AS response_sum,
         COUNT(response_time_ms) AS response_count
    FROM uptime_checks WHERE checked_at >= ?1 GROUP BY day, status`;

interface UptimeScalarsRow {
  monitors_total: number;
  monitors_down: number;
  open_incidents: number;
}

const UPTIME_SCALARS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM uptime_monitors WHERE deleted_at IS NULL) AS monitors_total,
    (SELECT COUNT(*) FROM uptime_monitors
      WHERE deleted_at IS NULL AND current_status = 'DOWN') AS monitors_down,
    (SELECT COUNT(*) FROM incidents WHERE status = 'OPEN') AS open_incidents`;

function centsFor(model: string | null, inputTokens: number, outputTokens: number): number {
  const price = (model !== null && MODEL_PRICES[model]) || DEFAULT_MODEL_PRICE;
  return (
    (inputTokens * price.inputCentsPerMTok + outputTokens * price.outputCentsPerMTok) / 1_000_000
  );
}

async function firstOr<T>(fallback: T, statement: D1PreparedStatement): Promise<T> {
  const row = await statement.first<T>();
  return row ?? fallback;
}

/** Same, but a missing migration degrades to the fallback instead of a 500. */
async function firstOrPending<T>(fallback: T, statement: D1PreparedStatement): Promise<T> {
  try {
    return await firstOr(fallback, statement);
  } catch (error) {
    if (isMigrationPendingError(error)) return fallback;
    throw error;
  }
}

async function allOrPending<T>(statement: D1PreparedStatement): Promise<T[]> {
  try {
    return (await statement.all<T>()).results;
  } catch (error) {
    if (isMigrationPendingError(error)) return [];
    throw error;
  }
}

export async function loadMetrics(
  db: D1Database,
  now: number,
  days: MetricRangeDays,
): Promise<Metrics> {
  const keys = dayKeys(now, days);
  const fromMs = startOfUtcDay(now) - (days - 1) * DAY_MS;
  const activeFrom = now - ACTIVE_WINDOW_MS;
  const dangerBefore = now - DANGER_WINDOW_MS;

  const [userScalars, userActivity, signups, runsByDay, testScalars, retries, spend, checksByDay, uptimeScalars] =
    await Promise.all([
      firstOr<UserScalarsRow>(
        { registered: 0, new_in_range: 0, users_before: 0, active_tokens: 0, danger_tokens: 0 },
        db.prepare(USER_SCALARS_SQL).bind(fromMs, activeFrom, dangerBefore),
      ),
      firstOrPending<UserActivityRow | null>(
        null,
        db.prepare(USER_ACTIVITY_SQL).bind(activeFrom, dangerBefore),
      ),
      db.prepare(SIGNUPS_SQL).bind(fromMs).all<SignupsRow>().then((r) => r.results),
      db.prepare(RUNS_BY_DAY_SQL).bind(fromMs).all<RunsDayRow>().then((r) => r.results),
      firstOr<TestScalarsRow>(
        { total: 0, owners: 0, failed_recent: 0 },
        db.prepare(TEST_SCALARS_SQL).bind(fromMs, now - FAILED_RECENT_WINDOW_MS),
      ),
      db.prepare(RETRIES_SQL).bind(fromMs).all<RetriesRow>().then((r) => r.results),
      allOrPending<SpendRow>(
        db.prepare(SPEND_SQL).bind(startOfUtcDay(now), now - 7 * DAY_MS, now - 30 * DAY_MS),
      ),
      db.prepare(CHECKS_BY_DAY_SQL).bind(fromMs).all<ChecksDayRow>().then((r) => r.results),
      firstOr<UptimeScalarsRow>(
        { monitors_total: 0, monitors_down: 0, open_incidents: 0 },
        db.prepare(UPTIME_SCALARS_SQL),
      ),
    ]);

  // Users series: cumulative = accounts before the range + running signups.
  const signupsByDay = new Map(signups.map((row) => [row.day, row.signups]));
  let cumulative = userScalars.users_before;
  const usersSeries = keys.map((day) => {
    const daySignups = signupsByDay.get(day) ?? 0;
    cumulative += daySignups;
    return { day, signups: daySignups, cumulative };
  });

  // Tests series: pivot status rows and average duration across every finished row.
  const testsByDay = new Map<string, TestsDayPoint & { durationSum: number; durationCount: number }>();
  for (const row of runsByDay) {
    const point = testsByDay.get(row.day) ?? {
      day: row.day,
      passed: 0,
      failed: 0,
      timeout: 0,
      systemError: 0,
      total: 0,
      avgDurationMs: null,
      durationSum: 0,
      durationCount: 0,
    };
    point.total += row.total;
    point.durationSum += row.duration_sum;
    point.durationCount += row.duration_count;
    if (row.status === "PASSED") point.passed += row.total;
    else if (row.status === "FAILED") point.failed += row.total;
    else if (row.status === "TIMEOUT") point.timeout += row.total;
    else if (row.status === "SYSTEM_ERROR") point.systemError += row.total;
    testsByDay.set(row.day, point);
  }
  const testsSeries = keys.map((day) => {
    const point = testsByDay.get(day);
    if (point === undefined) {
      return { day, passed: 0, failed: 0, timeout: 0, systemError: 0, total: 0, avgDurationMs: null };
    }
    const { durationSum, durationCount, ...rest } = point;
    return { ...rest, avgDurationMs: durationCount > 0 ? durationSum / durationCount : null };
  });

  const retriesSplit = { first: 0, second: 0, thirdPlus: 0 };
  for (const row of retries) {
    if (row.idx === 0) retriesSplit.first += row.passes;
    else if (row.idx === 1) retriesSplit.second += row.passes;
    else retriesSplit.thirdPlus += row.passes;
  }

  const spendCents = { today: 0, last7d: 0, last30d: 0 };
  for (const row of spend) {
    spendCents.today += centsFor(row.model, row.input_today, row.output_today);
    spendCents.last7d += centsFor(row.model, row.input_7d, row.output_7d);
    spendCents.last30d += centsFor(row.model, row.input_30d, row.output_30d);
  }
  spendCents.today = Math.round(spendCents.today);
  spendCents.last7d = Math.round(spendCents.last7d);
  spendCents.last30d = Math.round(spendCents.last30d);

  // Uptime series + overall ratio from the same rows.
  const uptimeByDay = new Map<string, UptimeDayPoint & { responseSum: number; responseCount: number }>();
  let checksTotal = 0;
  let checksUp = 0;
  for (const row of checksByDay) {
    const point = uptimeByDay.get(row.day) ?? {
      day: row.day,
      up: 0,
      down: 0,
      avgResponseMs: null,
      responseSum: 0,
      responseCount: 0,
    };
    if (row.status === "PASSED") point.up += row.total;
    else point.down += row.total;
    point.responseSum += row.response_sum;
    point.responseCount += row.response_count;
    uptimeByDay.set(row.day, point);
    checksTotal += row.total;
    if (row.status === "PASSED") checksUp += row.total;
  }
  const uptimeSeries = keys.map((day) => {
    const point = uptimeByDay.get(day);
    if (point === undefined) return { day, up: 0, down: 0, avgResponseMs: null };
    const { responseSum, responseCount, ...rest } = point;
    return { ...rest, avgResponseMs: responseCount > 0 ? responseSum / responseCount : null };
  });

  return {
    range: { days, from: keys[0] as string, to: keys[keys.length - 1] as string, now },
    users: {
      registered: userScalars.registered,
      newInRange: userScalars.new_in_range,
      active7d: userActivity?.active_combined ?? userScalars.active_tokens,
      danger: userActivity?.danger_combined ?? userScalars.danger_tokens,
      series: usersSeries,
    },
    tests: {
      total: testScalars.total,
      perUser: testScalars.owners > 0 ? testScalars.total / testScalars.owners : null,
      failed2h: testScalars.failed_recent,
      retries: retriesSplit,
      spendCents,
      series: testsSeries,
    },
    uptime: {
      upPercent: checksTotal > 0 ? (checksUp / checksTotal) * 100 : null,
      monitorsDown: uptimeScalars.monitors_down,
      monitorsTotal: uptimeScalars.monitors_total,
      openIncidents: uptimeScalars.open_incidents,
      series: uptimeSeries,
    },
  };
}

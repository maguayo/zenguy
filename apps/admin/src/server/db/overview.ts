import type {
  Overview,
  PastChecksWindow,
  PastRunsWindow,
  Windows,
} from "../../shared/types";
import { DAY_MS, HOUR_MS } from "../constants";
import { upcomingWindows } from "../occurrences";

const TERMINAL_RUN_STATUSES = new Set(["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"]);

interface CountsRow {
  total: number;
  verified: number | null;
  new_last_7d: number | null;
}

interface MonitorCountsRow {
  total: number;
  up: number | null;
  down: number | null;
  unknown: number | null;
}

interface RunStatusRow {
  status: string;
  total: number;
  duration_sum: number | null;
  duration_count: number;
}

interface CheckStatusRow {
  status: string;
  total: number;
  response_sum: number | null;
  response_count: number;
}

function toRunsWindow(rows: RunStatusRow[]): PastRunsWindow {
  const byStatus: Record<string, number> = {};
  let total = 0;
  let finished = 0;
  let passed = 0;
  let durationSum = 0;
  let durationCount = 0;
  for (const row of rows) {
    byStatus[row.status] = row.total;
    total += row.total;
    if (TERMINAL_RUN_STATUSES.has(row.status)) finished += row.total;
    if (row.status === "PASSED") passed += row.total;
    durationSum += row.duration_sum ?? 0;
    durationCount += row.duration_count;
  }
  return {
    total,
    byStatus,
    passRate: finished === 0 ? null : passed / finished,
    avgDurationMs: durationCount === 0 ? null : Math.round(durationSum / durationCount),
  };
}

function toChecksWindow(rows: CheckStatusRow[]): PastChecksWindow {
  let total = 0;
  let up = 0;
  let down = 0;
  let responseSum = 0;
  let responseCount = 0;
  for (const row of rows) {
    total += row.total;
    if (row.status === "PASSED") up += row.total;
    else down += row.total;
    responseSum += row.response_sum ?? 0;
    responseCount += row.response_count;
  }
  return {
    total,
    up,
    down,
    avgResponseMs: responseCount === 0 ? null : Math.round(responseSum / responseCount),
  };
}

async function runsWindow(
  db: D1Database,
  now: number,
  hours: number,
): Promise<PastRunsWindow> {
  const { results } = await db
    .prepare(
      `SELECT status,
              COUNT(*) AS total,
              SUM(duration_ms) AS duration_sum,
              COUNT(duration_ms) AS duration_count
       FROM test_runs
       WHERE created_at >= ?
       GROUP BY status`,
    )
    .bind(now - hours * HOUR_MS)
    .all<RunStatusRow>();
  return toRunsWindow(results);
}

async function checksWindow(
  db: D1Database,
  now: number,
  hours: number,
): Promise<PastChecksWindow> {
  const { results } = await db
    .prepare(
      `SELECT status,
              COUNT(*) AS total,
              SUM(response_time_ms) AS response_sum,
              COUNT(response_time_ms) AS response_count
       FROM uptime_checks
       WHERE checked_at >= ?
       GROUP BY status`,
    )
    .bind(now - hours * HOUR_MS)
    .all<CheckStatusRow>();
  return toChecksWindow(results);
}

async function pastRunWindows(db: D1Database, now: number): Promise<Windows<PastRunsWindow>> {
  const [h1, h3, h24] = await Promise.all([
    runsWindow(db, now, 1),
    runsWindow(db, now, 3),
    runsWindow(db, now, 24),
  ]);
  return { h1, h3, h24 };
}

async function pastCheckWindows(
  db: D1Database,
  now: number,
): Promise<Windows<PastChecksWindow>> {
  const [h1, h3, h24] = await Promise.all([
    checksWindow(db, now, 1),
    checksWindow(db, now, 3),
    checksWindow(db, now, 24),
  ]);
  return { h1, h3, h24 };
}

/** Platform-wide counters and the past/upcoming activity windows. Read only. */
export async function loadOverview(db: D1Database, now: number): Promise<Overview> {
  const [
    users,
    workspaces,
    browserTests,
    monitors,
    pastRuns,
    pastChecks,
    dueTests,
    dueMonitors,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN email_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_last_7d
         FROM users`,
      )
      .bind(now - 7 * DAY_MS)
      .first<CountsRow>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM workspaces WHERE deleted_at IS NULL`)
      .first<{ total: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS active FROM browser_tests WHERE deleted_at IS NULL`)
      .first<{ active: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN current_status = 'UP' THEN 1 ELSE 0 END) AS up,
                SUM(CASE WHEN current_status = 'DOWN' THEN 1 ELSE 0 END) AS down,
                SUM(CASE WHEN current_status = 'UNKNOWN' THEN 1 ELSE 0 END) AS unknown
         FROM uptime_monitors
         WHERE deleted_at IS NULL`,
      )
      .first<MonitorCountsRow>(),
    pastRunWindows(db, now),
    pastCheckWindows(db, now),
    db
      .prepare(
        `SELECT next_run_at, interval_hours FROM browser_tests WHERE deleted_at IS NULL`,
      )
      .all<{ next_run_at: number; interval_hours: number }>(),
    db
      .prepare(
        `SELECT next_check_at, frequency_seconds FROM uptime_monitors WHERE deleted_at IS NULL`,
      )
      .all<{ next_check_at: number; frequency_seconds: number }>(),
  ]);

  return {
    users: {
      total: users?.total ?? 0,
      verified: users?.verified ?? 0,
      newLast7d: users?.new_last_7d ?? 0,
    },
    workspaces: { total: workspaces?.total ?? 0 },
    browserTests: { active: browserTests?.active ?? 0 },
    uptimeMonitors: {
      total: monitors?.total ?? 0,
      up: monitors?.up ?? 0,
      down: monitors?.down ?? 0,
      unknown: monitors?.unknown ?? 0,
    },
    browserRuns: {
      past: pastRuns,
      upcoming: upcomingWindows(
        dueTests.results.map((row) => ({
          nextAt: row.next_run_at,
          intervalMs: row.interval_hours * HOUR_MS,
        })),
        now,
      ),
    },
    uptimeChecks: {
      past: pastChecks,
      upcoming: upcomingWindows(
        dueMonitors.results.map((row) => ({
          nextAt: row.next_check_at,
          intervalMs: row.frequency_seconds * 1_000,
        })),
        now,
      ),
    },
  };
}

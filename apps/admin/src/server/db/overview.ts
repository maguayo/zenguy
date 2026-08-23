import type {
  Overview,
  PastChecksWindow,
  PastRunsWindow,
  Windows,
} from "../../shared/types";
import { DAY_MS, HOUR_MS } from "../constants";
import { upcomingWindows } from "../occurrences";

const TERMINAL_RUN_STATUSES = new Set(["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"]);

type WindowKey = "h1" | "h3" | "h24";

/** Bound as ?1/?2/?3 by the window queries: the h1, h3 and h24 cut-offs. */
function cutoffs(now: number): [number, number, number] {
  return [now - HOUR_MS, now - 3 * HOUR_MS, now - 24 * HOUR_MS];
}

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

interface RunWindowRow {
  status: string;
  h1_total: number;
  h1_duration_sum: number | null;
  h1_duration_count: number;
  h3_total: number;
  h3_duration_sum: number | null;
  h3_duration_count: number;
  h24_total: number;
  h24_duration_sum: number | null;
  h24_duration_count: number;
}

interface CheckWindowRow {
  status: string;
  h1_total: number;
  h1_response_sum: number | null;
  h1_response_count: number;
  h3_total: number;
  h3_response_sum: number | null;
  h3_response_count: number;
  h24_total: number;
  h24_response_sum: number | null;
  h24_response_count: number;
}

function toRunsWindow(rows: RunWindowRow[], key: WindowKey): PastRunsWindow {
  const byStatus: Record<string, number> = {};
  let total = 0;
  let finished = 0;
  let passed = 0;
  let durationSum = 0;
  let durationCount = 0;
  for (const row of rows) {
    const count = row[`${key}_total`];
    // The status only has rows in a wider window: it is absent from this one.
    if (count === 0) continue;
    byStatus[row.status] = count;
    total += count;
    if (TERMINAL_RUN_STATUSES.has(row.status)) finished += count;
    if (row.status === "PASSED") passed += count;
    durationSum += row[`${key}_duration_sum`] ?? 0;
    durationCount += row[`${key}_duration_count`];
  }
  return {
    total,
    byStatus,
    passRate: finished === 0 ? null : passed / finished,
    avgDurationMs: durationCount === 0 ? null : Math.round(durationSum / durationCount),
  };
}

function toChecksWindow(rows: CheckWindowRow[], key: WindowKey): PastChecksWindow {
  let total = 0;
  let up = 0;
  let down = 0;
  let responseSum = 0;
  let responseCount = 0;
  for (const row of rows) {
    const count = row[`${key}_total`];
    if (count === 0) continue;
    total += count;
    if (row.status === "PASSED") up += count;
    else down += count;
    responseSum += row[`${key}_response_sum`] ?? 0;
    responseCount += row[`${key}_response_count`];
  }
  return {
    total,
    up,
    down,
    avgResponseMs: responseCount === 0 ? null : Math.round(responseSum / responseCount),
  };
}

/**
 * All three windows out of a single 24 h scan. The panel polls the overview
 * every 30 seconds against the production database, so one GROUP BY query per
 * window meant three full scans of the table per request; the CASE columns
 * bucket the same rows in one pass (see migration 0024 for the index).
 */
async function pastRunWindows(db: D1Database, now: number): Promise<Windows<PastRunsWindow>> {
  const { results } = await db
    .prepare(
      `SELECT status,
              SUM(CASE WHEN created_at >= ?1 THEN 1 ELSE 0 END) AS h1_total,
              SUM(CASE WHEN created_at >= ?1 THEN COALESCE(duration_ms, 0) ELSE 0 END)
                AS h1_duration_sum,
              SUM(CASE WHEN created_at >= ?1 AND duration_ms IS NOT NULL THEN 1 ELSE 0 END)
                AS h1_duration_count,
              SUM(CASE WHEN created_at >= ?2 THEN 1 ELSE 0 END) AS h3_total,
              SUM(CASE WHEN created_at >= ?2 THEN COALESCE(duration_ms, 0) ELSE 0 END)
                AS h3_duration_sum,
              SUM(CASE WHEN created_at >= ?2 AND duration_ms IS NOT NULL THEN 1 ELSE 0 END)
                AS h3_duration_count,
              COUNT(*) AS h24_total,
              SUM(COALESCE(duration_ms, 0)) AS h24_duration_sum,
              COUNT(duration_ms) AS h24_duration_count
       FROM test_runs
       WHERE created_at >= ?3
       GROUP BY status`,
    )
    .bind(...cutoffs(now))
    .all<RunWindowRow>();
  return {
    h1: toRunsWindow(results, "h1"),
    h3: toRunsWindow(results, "h3"),
    h24: toRunsWindow(results, "h24"),
  };
}

/** Same single-scan shape as pastRunWindows, over uptime_checks.checked_at. */
async function pastCheckWindows(
  db: D1Database,
  now: number,
): Promise<Windows<PastChecksWindow>> {
  const { results } = await db
    .prepare(
      `SELECT status,
              SUM(CASE WHEN checked_at >= ?1 THEN 1 ELSE 0 END) AS h1_total,
              SUM(CASE WHEN checked_at >= ?1 THEN COALESCE(response_time_ms, 0) ELSE 0 END)
                AS h1_response_sum,
              SUM(CASE WHEN checked_at >= ?1 AND response_time_ms IS NOT NULL THEN 1 ELSE 0 END)
                AS h1_response_count,
              SUM(CASE WHEN checked_at >= ?2 THEN 1 ELSE 0 END) AS h3_total,
              SUM(CASE WHEN checked_at >= ?2 THEN COALESCE(response_time_ms, 0) ELSE 0 END)
                AS h3_response_sum,
              SUM(CASE WHEN checked_at >= ?2 AND response_time_ms IS NOT NULL THEN 1 ELSE 0 END)
                AS h3_response_count,
              COUNT(*) AS h24_total,
              SUM(COALESCE(response_time_ms, 0)) AS h24_response_sum,
              COUNT(response_time_ms) AS h24_response_count
       FROM uptime_checks
       WHERE checked_at >= ?3
       GROUP BY status`,
    )
    .bind(...cutoffs(now))
    .all<CheckWindowRow>();
  return {
    h1: toChecksWindow(results, "h1"),
    h3: toChecksWindow(results, "h3"),
    h24: toChecksWindow(results, "h24"),
  };
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

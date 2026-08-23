import type { RecentRun } from "../../shared/types";
import { isMigrationPendingError } from "./errors";

interface RunRow {
  id: string;
  created_at: number;
  source: string;
  status: string;
  duration_ms: number | null;
  attempt_count: number;
  passed_after_retry: number;
  workspace_name: string | null;
  test_name: string | null;
  runner_id?: string | null;
  runner_kind?: string | null;
}

/** Which attempt columns the bound database is known to have. */
interface RunnerColumns {
  withRunnerId: boolean;
  withRunnerKind: boolean;
}

function lastAttemptColumn(column: string, alias: string): string {
  return `(SELECT attempts.${column} FROM test_attempts AS attempts
             WHERE attempts.test_run_id = runs.id
             ORDER BY attempts.attempt_index DESC LIMIT 1) AS ${alias},`;
}

function recentRunsQuery({ withRunnerId, withRunnerKind }: RunnerColumns): string {
  return `SELECT ${withRunnerId ? lastAttemptColumn("claimed_by_runner_id", "runner_id") : ""}
                 ${withRunnerKind ? lastAttemptColumn("runner_kind", "runner_kind") : ""}
                 runs.id, runs.created_at, runs.source, runs.status, runs.duration_ms,
                 runs.attempt_count, runs.passed_after_retry,
                 workspaces.name AS workspace_name,
                 json_extract(runs.snapshot_json, '$.name') AS test_name
          FROM test_runs AS runs
          LEFT JOIN workspaces ON workspaces.id = runs.workspace_id
          ORDER BY runs.created_at DESC
          LIMIT ?`;
}

function toRecentRun(row: RunRow, columns: RunnerColumns): RecentRun {
  return {
    id: row.id,
    createdAt: row.created_at,
    workspaceName: row.workspace_name,
    testName: row.test_name,
    source: row.source,
    status: row.status,
    durationMs: row.duration_ms,
    attemptCount: row.attempt_count,
    passedAfterRetry: row.passed_after_retry === 1,
    runnerId: columns.withRunnerId ? (row.runner_id ?? null) : "MIGRATION_PENDING",
    runnerKind: columns.withRunnerKind ? (row.runner_kind ?? null) : null,
  };
}

// Widest first: claimed_by_runner_id ships in 0023 and runner_kind in 0021, so a
// database behind either one must still list runs instead of failing the request.
const VARIANTS: RunnerColumns[] = [
  { withRunnerId: true, withRunnerKind: true },
  { withRunnerId: false, withRunnerKind: true },
  { withRunnerId: false, withRunnerKind: false },
];

/**
 * The newest runs with the worker that executed the last attempt. Degrades to
 * MIGRATION_PENDING attribution while the bound database predates 0023, and to
 * a plain listing while it also predates 0021.
 */
export async function loadRecentRuns(db: D1Database, limit: number): Promise<RecentRun[]> {
  let lastError: unknown;
  for (const columns of VARIANTS) {
    try {
      const { results } = await db.prepare(recentRunsQuery(columns)).bind(limit).all<RunRow>();
      return results.map((row) => toRecentRun(row, columns));
    } catch (error) {
      if (!isMigrationPendingError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

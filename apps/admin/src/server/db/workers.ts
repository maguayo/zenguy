import type { WorkerSummary, WorkersResponse } from "../../shared/types";
import { RUNNER_ONLINE_THRESHOLD_MS } from "../constants";
import { isMigrationPendingError } from "./errors";

interface WorkerRow {
  id: string;
  mode: WorkerSummary["mode"];
  version: string;
  started_at: number;
  first_seen_at: number;
  last_seen_at: number;
}

interface AttemptRow {
  attempt_id: string;
  run_id: string;
  runner_id: string;
  started_at: number | null;
  test_name: string | null;
  workspace_name: string | null;
}

/**
 * Every runner worker that has ever sent a heartbeat, newest first, with the
 * attempt it is executing right now. Returns MIGRATION_PENDING while the
 * bound database predates migration 0023.
 */
export async function loadWorkers(db: D1Database, now: number): Promise<WorkersResponse> {
  try {
    const [workers, attempts] = await Promise.all([
      db
        .prepare(
          `SELECT id, mode, version, started_at, first_seen_at, last_seen_at
           FROM runner_workers
           ORDER BY last_seen_at DESC`,
        )
        .all<WorkerRow>(),
      db
        .prepare(
          `SELECT attempts.id AS attempt_id,
                  attempts.test_run_id AS run_id,
                  attempts.claimed_by_runner_id AS runner_id,
                  attempts.started_at,
                  json_extract(runs.snapshot_json, '$.name') AS test_name,
                  workspaces.name AS workspace_name
           FROM test_attempts AS attempts
           JOIN test_runs AS runs ON runs.id = attempts.test_run_id
           LEFT JOIN workspaces ON workspaces.id = runs.workspace_id
           WHERE attempts.status IN ('STARTING', 'RUNNING')
             AND attempts.claimed_by_runner_id IS NOT NULL`,
        )
        .all<AttemptRow>(),
    ]);

    const byRunner = new Map(attempts.results.map((row) => [row.runner_id, row]));
    return {
      now,
      workers: workers.results.map((row) => {
        const attempt = byRunner.get(row.id);
        return {
          id: row.id,
          mode: row.mode,
          version: row.version,
          startedAt: row.started_at,
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
          online: now - row.last_seen_at < RUNNER_ONLINE_THRESHOLD_MS,
          currentAttempt:
            attempt === undefined
              ? null
              : {
                  attemptId: attempt.attempt_id,
                  runId: attempt.run_id,
                  testName: attempt.test_name,
                  workspaceName: attempt.workspace_name,
                  startedAt: attempt.started_at,
                },
        };
      }),
    };
  } catch (error) {
    if (isMigrationPendingError(error)) return { unavailable: "MIGRATION_PENDING" };
    throw error;
  }
}

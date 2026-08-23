import type { WorkerSummary, WorkersResponse } from "../../shared/types";
import { DAY_MS, RUNNER_ONLINE_THRESHOLD_MS } from "../constants";
import { isMigrationPendingError } from "./errors";

interface WorkerRow {
  id: string;
  mode: WorkerSummary["mode"];
  version: string;
  started_at: number;
  first_seen_at: number;
  last_seen_at: number;
}

interface WorkerStatsRow {
  runner_id: string;
  runs_24h: number;
  runs_7d: number;
  tokens_24h: number | null;
}

interface AttemptRow {
  attempt_id: string;
  run_id: string;
  runner_id: string;
  started_at: number | null;
  test_name: string | null;
  workspace_name: string | null;
}

const EMPTY_STATS = { runs_24h: 0, runs_7d: 0, tokens_24h: 0 };

/**
 * Runs claimed per worker over the last 24 h and 7 d, windowed on the run's
 * created_at. Driving the scan from test_runs is what keeps it off a full
 * test_attempts table scan: only idx_test_runs_created_at (0024) honours a bare
 * date bound, and idx_attempts_run_index then serves the join.
 *
 * The two counters are DISTINCT over runs, not over attempts: a run this worker
 * retried three times is still one run it worked on, and "runs 7 d" beside a run
 * count anywhere else on the panel has to mean the same thing. `tokens_24h`
 * stays a plain sum over attempts — every attempt spent its own tokens.
 *
 * The token columns arrive in 0021, which every database carrying
 * claimed_by_runner_id (0023) already has, so the catch is defence only:
 * counters go to zero rather than taking the whole payload down with them.
 */
async function loadWorkerStats(
  db: D1Database,
  now: number,
): Promise<Map<string, WorkerStatsRow>> {
  try {
    const { results } = await db
      .prepare(
        `SELECT attempts.claimed_by_runner_id AS runner_id,
                COUNT(DISTINCT CASE WHEN runs.created_at >= ?1 THEN runs.id END) AS runs_24h,
                COUNT(DISTINCT runs.id) AS runs_7d,
                SUM(CASE WHEN runs.created_at >= ?1
                         THEN COALESCE(attempts.input_tokens, 0)
                            + COALESCE(attempts.output_tokens, 0)
                         ELSE 0 END) AS tokens_24h
         FROM test_runs AS runs
         JOIN test_attempts AS attempts ON attempts.test_run_id = runs.id
          AND attempts.claimed_by_runner_id IS NOT NULL
         WHERE runs.created_at >= ?2
         GROUP BY attempts.claimed_by_runner_id`,
      )
      .bind(now - DAY_MS, now - 7 * DAY_MS)
      .all<WorkerStatsRow>();
    return new Map(results.map((row) => [row.runner_id, row]));
  } catch (error) {
    if (isMigrationPendingError(error)) return new Map();
    throw error;
  }
}

/**
 * Every runner worker that has ever sent a heartbeat, newest first, with the
 * attempt it is executing right now. Returns MIGRATION_PENDING while the
 * bound database predates migration 0023.
 */
export async function loadWorkers(db: D1Database, now: number): Promise<WorkersResponse> {
  try {
    const [workers, attempts, stats] = await Promise.all([
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
      loadWorkerStats(db, now),
    ]);

    const byRunner = new Map(attempts.results.map((row) => [row.runner_id, row]));
    return {
      now,
      workers: workers.results.map((row) => {
        const attempt = byRunner.get(row.id);
        const counters = stats.get(row.id) ?? EMPTY_STATS;
        return {
          id: row.id,
          mode: row.mode,
          version: row.version,
          startedAt: row.started_at,
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
          online: now - row.last_seen_at < RUNNER_ONLINE_THRESHOLD_MS,
          runs24h: counters.runs_24h,
          runs7d: counters.runs_7d,
          tokens24h: counters.tokens_24h ?? 0,
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

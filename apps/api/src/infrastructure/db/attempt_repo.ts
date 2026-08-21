import type {
  AttemptRepo,
  AttemptUpdate,
} from "../../domain/browser_tests/repo";
import type {
  AttemptStatus,
  AttemptWithLatest,
  TestAttempt,
} from "../../domain/browser_tests/types";
import type { UsageEvent } from "../../domain/billing/types";
import { all, batch, one, run } from "./d1";

interface AttemptRow {
  id: string;
  test_run_id: string;
  attempt_index: number;
  status: AttemptStatus;
  retry_delay_seconds: number;
  queued_at: number;
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
  summary: string | null;
  expected_result: string | null;
  actual_result: string | null;
  failure_reason: string | null;
  visited_urls_json: string | null;
  console_errors_json: string | null;
  network_errors_json: string | null;
  token_usage: number | null;
  model_name: string | null;
  runner_version: string | null;
  system_error_code: string | null;
  created_at: number;
}

function toAttempt(row: AttemptRow): TestAttempt {
  return {
    id: row.id,
    testRunId: row.test_run_id,
    attemptIndex: row.attempt_index,
    status: row.status,
    retryDelaySeconds: row.retry_delay_seconds,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    summary: row.summary,
    expectedResult: row.expected_result,
    actualResult: row.actual_result,
    failureReason: row.failure_reason,
    visitedUrlsJson: row.visited_urls_json,
    consoleErrorsJson: row.console_errors_json,
    networkErrorsJson: row.network_errors_json,
    tokenUsage: row.token_usage,
    modelName: row.model_name,
    runnerVersion: row.runner_version,
    systemErrorCode: row.system_error_code,
    createdAt: row.created_at,
  };
}

export class D1AttemptRepo implements AttemptRepo {
  constructor(private readonly database: D1Database) {}

  async insert(attempt: TestAttempt): Promise<void> {
    await run(
      this.database
        .prepare(
          `INSERT INTO test_attempts
            (id, test_run_id, attempt_index, status, retry_delay_seconds,
             queued_at, started_at, finished_at, duration_ms, summary,
             expected_result, actual_result, failure_reason, visited_urls_json,
             console_errors_json, network_errors_json, token_usage, model_name,
             runner_version, system_error_code, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          attempt.id,
          attempt.testRunId,
          attempt.attemptIndex,
          attempt.status,
          attempt.retryDelaySeconds,
          attempt.queuedAt,
          attempt.startedAt,
          attempt.finishedAt,
          attempt.durationMs,
          attempt.summary,
          attempt.expectedResult,
          attempt.actualResult,
          attempt.failureReason,
          attempt.visitedUrlsJson,
          attempt.consoleErrorsJson,
          attempt.networkErrorsJson,
          attempt.tokenUsage,
          attempt.modelName,
          attempt.runnerVersion,
          attempt.systemErrorCode,
          attempt.createdAt,
        ),
    );
  }

  async findById(id: string): Promise<TestAttempt | null> {
    const row = await one<AttemptRow>(
      this.database.prepare("SELECT * FROM test_attempts WHERE id = ?").bind(id),
    );
    return row === null ? null : toAttempt(row);
  }

  async claimQueued(
    id: string,
    claimedAt: number,
    runnerDeliveryId?: string,
  ): Promise<boolean> {
    const result = await run(
      this.database
        .prepare(
          `UPDATE test_attempts
           SET status = 'STARTING', started_at = ?, runner_delivery_id = ?
           WHERE id = ? AND status = 'QUEUED' AND queued_at <= ?`,
        )
        .bind(claimedAt, runnerDeliveryId ?? null, id, claimedAt),
    );
    return result.meta.changes === 1;
  }

  async isRunnerDeliveryOwner(
    id: string,
    runnerDeliveryId: string,
  ): Promise<boolean> {
    const row = await one<{ owned: number }>(
      this.database
        .prepare(
          `SELECT 1 AS owned
           FROM test_attempts
           WHERE id = ? AND runner_delivery_id = ?`,
        )
        .bind(id, runnerDeliveryId),
    );
    return row !== null;
  }

  async markRunning(
    id: string,
    runId: string,
    attemptIndex: number,
    startedAt: number,
    usageEvent: UsageEvent,
  ): Promise<boolean> {
    if (usageEvent.testRunId !== runId) return false;

    const [, , attemptResult] = await batch(this.database, [
      this.database
        .prepare(
          `INSERT OR IGNORE INTO usage_events
            (id, workspace_id, test_run_id, type, quantity, billable,
             idempotency_key, occurred_at, reversed_at, created_at)
           SELECT ?, runs.workspace_id, runs.id, ?, ?, ?, ?, ?, ?, ?
           FROM test_runs AS runs
           JOIN test_attempts AS attempts ON attempts.test_run_id = runs.id
           WHERE runs.id = ?
             AND runs.workspace_id = ?
             AND runs.status IN ('QUEUED', 'RUNNING')
             AND attempts.id = ?
             AND attempts.attempt_index = ?
             AND attempts.status = 'STARTING'
             AND (
               runs.usage_event_id IS NULL
               OR EXISTS (
                 SELECT 1
                 FROM usage_events AS current_usage
                 WHERE current_usage.id = runs.usage_event_id
                   AND current_usage.test_run_id = runs.id
                   AND current_usage.workspace_id = runs.workspace_id
                   AND current_usage.idempotency_key = ?
               )
             )`,
        )
        .bind(
          usageEvent.id,
          usageEvent.type,
          usageEvent.quantity,
          usageEvent.billable ? 1 : 0,
          usageEvent.idempotencyKey,
          usageEvent.occurredAt,
          usageEvent.reversedAt,
          usageEvent.createdAt,
          runId,
          usageEvent.workspaceId,
          id,
          attemptIndex,
          usageEvent.idempotencyKey,
        ),
      this.database
        .prepare(
          `UPDATE test_runs
           SET status = 'RUNNING', started_at = COALESCE(started_at, ?),
               usage_event_id = (
                 SELECT usage.id
                 FROM usage_events AS usage
                 WHERE usage.test_run_id = ?
                   AND usage.workspace_id = ?
                   AND usage.idempotency_key = ?
               )
           WHERE id = ?
             AND workspace_id = ?
             AND status IN ('QUEUED', 'RUNNING')
             AND EXISTS (
               SELECT 1
               FROM test_attempts AS attempts
               WHERE attempts.id = ?
                 AND attempts.test_run_id = test_runs.id
                 AND attempts.attempt_index = ?
                 AND attempts.status = 'STARTING'
             )
             AND EXISTS (
               SELECT 1
               FROM usage_events AS usage
               WHERE usage.test_run_id = test_runs.id
                 AND usage.workspace_id = test_runs.workspace_id
                 AND usage.idempotency_key = ?
             )
             AND (
               usage_event_id IS NULL
               OR usage_event_id = (
                 SELECT usage.id
                 FROM usage_events AS usage
                 WHERE usage.test_run_id = test_runs.id
                   AND usage.workspace_id = test_runs.workspace_id
                   AND usage.idempotency_key = ?
               )
             )`,
        )
        .bind(
          startedAt,
          runId,
          usageEvent.workspaceId,
          usageEvent.idempotencyKey,
          runId,
          usageEvent.workspaceId,
          id,
          attemptIndex,
          usageEvent.idempotencyKey,
          usageEvent.idempotencyKey,
        ),
      this.database
        .prepare(
          `UPDATE test_attempts
           SET status = 'RUNNING', started_at = ?
           WHERE id = ?
             AND test_run_id = ?
             AND attempt_index = ?
             AND status = 'STARTING'
             AND EXISTS (
               SELECT 1
               FROM test_runs AS runs
               JOIN usage_events AS usage ON usage.id = runs.usage_event_id
               WHERE runs.id = test_attempts.test_run_id
                 AND runs.status = 'RUNNING'
                 AND usage.test_run_id = runs.id
                 AND usage.workspace_id = runs.workspace_id
                 AND usage.idempotency_key = ?
             )`,
        )
        .bind(
          startedAt,
          id,
          runId,
          attemptIndex,
          usageEvent.idempotencyKey,
        ),
    ]);
    return attemptResult?.meta.changes === 1;
  }

  async findByRunAndIndex(
    runId: string,
    attemptIndex: number,
  ): Promise<TestAttempt | null> {
    const row = await one<AttemptRow>(
      this.database
        .prepare(
          `SELECT * FROM test_attempts
           WHERE test_run_id = ? AND attempt_index = ?`,
        )
        .bind(runId, attemptIndex),
    );
    return row === null ? null : toAttempt(row);
  }

  async listForRun(runId: string): Promise<TestAttempt[]> {
    return (
      await all<AttemptRow>(
        this.database
          .prepare(
            `SELECT * FROM test_attempts WHERE test_run_id = ?
             ORDER BY attempt_index ASC`,
          )
          .bind(runId),
      )
    ).map(toAttempt);
  }

  async listForRunWithLatest(runId: string): Promise<AttemptWithLatest[]> {
    const rows = await all<
      AttemptRow & {
        latest_step_description: string | null;
        latest_step_action_type: string | null;
        latest_step_timestamp: number | null;
        latest_screenshot_id: string | null;
      }
    >(
      this.database
        .prepare(
          `WITH latest_steps AS (
             SELECT attempt_id, description, action_type, timestamp,
                    ROW_NUMBER() OVER (
                      PARTITION BY attempt_id ORDER BY sequence DESC, id DESC
                    ) AS row_number
             FROM run_steps
           ), latest_screenshots AS (
             SELECT attempt_id, id,
                    ROW_NUMBER() OVER (
                      PARTITION BY attempt_id ORDER BY created_at DESC, id DESC
                    ) AS row_number
             FROM run_artifacts
             WHERE type = 'SCREENSHOT' AND attempt_id IS NOT NULL
           )
           SELECT attempts.*,
                  steps.description AS latest_step_description,
                  steps.action_type AS latest_step_action_type,
                  steps.timestamp AS latest_step_timestamp,
                  screenshots.id AS latest_screenshot_id
           FROM test_attempts AS attempts
           LEFT JOIN latest_steps AS steps
             ON steps.attempt_id = attempts.id AND steps.row_number = 1
           LEFT JOIN latest_screenshots AS screenshots
             ON screenshots.attempt_id = attempts.id
            AND screenshots.row_number = 1
           WHERE attempts.test_run_id = ?
           ORDER BY attempts.attempt_index ASC`,
        )
        .bind(runId),
    );
    return rows.map((row) => ({
      attempt: toAttempt(row),
      latestStep:
        row.latest_step_description === null ||
        row.latest_step_action_type === null ||
        row.latest_step_timestamp === null
          ? null
          : {
              description: row.latest_step_description,
              actionType: row.latest_step_action_type,
              timestamp: row.latest_step_timestamp,
            },
      latestScreenshot:
        row.latest_screenshot_id === null
          ? null
          : { id: row.latest_screenshot_id },
    }));
  }

  async update(id: string, fields: AttemptUpdate): Promise<void> {
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    const add = (column: string, value: string | number | null): void => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    if (fields.status !== undefined) add("status", fields.status);
    if (fields.retryDelaySeconds !== undefined) {
      add("retry_delay_seconds", fields.retryDelaySeconds);
    }
    if (fields.queuedAt !== undefined) add("queued_at", fields.queuedAt);
    if (fields.startedAt !== undefined) add("started_at", fields.startedAt);
    if (fields.finishedAt !== undefined) add("finished_at", fields.finishedAt);
    if (fields.durationMs !== undefined) add("duration_ms", fields.durationMs);
    if (fields.summary !== undefined) add("summary", fields.summary);
    if (fields.expectedResult !== undefined) {
      add("expected_result", fields.expectedResult);
    }
    if (fields.actualResult !== undefined) {
      add("actual_result", fields.actualResult);
    }
    if (fields.failureReason !== undefined) {
      add("failure_reason", fields.failureReason);
    }
    if (fields.visitedUrlsJson !== undefined) {
      add("visited_urls_json", fields.visitedUrlsJson);
    }
    if (fields.consoleErrorsJson !== undefined) {
      add("console_errors_json", fields.consoleErrorsJson);
    }
    if (fields.networkErrorsJson !== undefined) {
      add("network_errors_json", fields.networkErrorsJson);
    }
    if (fields.tokenUsage !== undefined) add("token_usage", fields.tokenUsage);
    if (fields.modelName !== undefined) add("model_name", fields.modelName);
    if (fields.runnerVersion !== undefined) {
      add("runner_version", fields.runnerVersion);
    }
    if (fields.systemErrorCode !== undefined) {
      add("system_error_code", fields.systemErrorCode);
    }
    if (assignments.length === 0) return;
    await run(
      this.database
        .prepare(
          `UPDATE test_attempts SET ${assignments.join(", ")} WHERE id = ?`,
        )
        .bind(...values, id),
    );
  }

  async resetForInfraRetry(id: string, queuedAt: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE test_attempts
           SET status = 'QUEUED', queued_at = ?, started_at = NULL,
               runner_delivery_id = NULL,
               finished_at = NULL, duration_ms = NULL, summary = NULL,
               expected_result = NULL, actual_result = NULL,
               failure_reason = NULL, visited_urls_json = NULL,
               console_errors_json = NULL, network_errors_json = NULL,
               token_usage = NULL, model_name = NULL, runner_version = NULL,
               system_error_code = NULL
           WHERE id = ?`,
        )
        .bind(queuedAt, id),
    );
  }

  async listStale(before: number): Promise<TestAttempt[]> {
    return (
      await all<AttemptRow>(
        this.database
          .prepare(
            `SELECT * FROM test_attempts
             WHERE status IN ('STARTING', 'RUNNING') AND started_at < ?
             ORDER BY started_at ASC, id ASC`,
          )
          .bind(before),
      )
    ).map(toAttempt);
  }

  async listExternallyClaimable(
    queuedBefore: number,
    abandonedBefore: number,
    limit: number,
  ): Promise<TestAttempt[]> {
    return (
      await all<AttemptRow>(
        this.database
          .prepare(
            `SELECT attempts.* FROM test_attempts AS attempts
             JOIN test_runs AS runs ON runs.id = attempts.test_run_id
             WHERE runs.status IN ('QUEUED', 'RUNNING')
               AND (
                 (attempts.status = 'QUEUED' AND attempts.queued_at <= ?)
                 OR (
                   attempts.status IN ('STARTING', 'RUNNING')
                   AND attempts.started_at IS NOT NULL
                   AND attempts.started_at < ?
                 )
               )
             ORDER BY attempts.queued_at ASC, attempts.id ASC
             LIMIT ?`,
          )
          .bind(queuedBefore, abandonedBefore, limit),
      )
    ).map(toAttempt);
  }
}

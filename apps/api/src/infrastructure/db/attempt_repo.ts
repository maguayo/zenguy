import type {
  AttemptRepo,
  AttemptUpdate,
} from "../../domain/browser_tests/repo";
import type {
  AttemptStatus,
  TestAttempt,
} from "../../domain/browser_tests/types";
import { all, one, run } from "./d1";

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
}

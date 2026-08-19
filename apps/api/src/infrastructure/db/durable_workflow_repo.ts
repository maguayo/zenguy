import type {
  DurableWorkflowRepo,
  OutboxRepo,
} from "../../domain/durability/repo";
import type {
  DurableJob,
  DurableJobKind,
  DurableQueueKind,
  QueueOutboxEntry,
} from "../../domain/durability/types";
import type { AttemptUpdate } from "../../domain/browser_tests/repo";
import type { TestAttempt, TestRun } from "../../domain/browser_tests/types";
import type { NotificationDelivery } from "../../domain/channels/types";
import type { UptimeCheck } from "../../domain/uptime/types";
import { validateDurableJobPayload } from "../../domain/durability/schemas";
import { platformAlert } from "../../shared/log";
import { batch, isUniqueConstraintError, one, run } from "./d1";

interface OutboxRow {
  id: string;
  dedupe_key: string;
  queue_kind: DurableQueueKind;
  payload_json: string;
  available_at: number;
  publishing_at: number | null;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

interface JobRow {
  id: string;
  kind: DurableJobKind;
  aggregate_key: string;
  payload_json: string;
  status: DurableJob["status"];
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

function toOutbox(row: OutboxRow): QueueOutboxEntry {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    queueKind: row.queue_kind,
    payloadJson: row.payload_json,
    availableAt: row.available_at,
    publishingAt: row.publishing_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toJob(row: JobRow): DurableJob {
  return {
    id: row.id,
    kind: row.kind,
    aggregateKey: row.aggregate_key,
    payloadJson: row.payload_json,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function insertRunStatement(database: D1Database, value: TestRun) {
  return database
    .prepare(
      `INSERT INTO test_runs
        (id, workspace_id, browser_test_id, source, status, snapshot_json,
         scheduled_for, queued_at, started_at, finished_at, duration_ms,
         attempt_count, infra_attempts, passed_after_retry, billable,
         usage_event_id, triggered_by_user_id, incident_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      value.id,
      value.workspaceId,
      value.browserTestId,
      value.source,
      value.status,
      JSON.stringify(value.snapshot),
      value.scheduledFor,
      value.queuedAt,
      value.startedAt,
      value.finishedAt,
      value.durationMs,
      value.attemptCount,
      value.infraAttempts,
      value.passedAfterRetry ? 1 : 0,
      value.billable ? 1 : 0,
      value.usageEventId,
      value.triggeredByUserId,
      value.incidentId,
      value.createdAt,
    );
}

function insertAttemptStatement(database: D1Database, attempt: TestAttempt) {
  return database
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
    );
}

function insertOutboxStatement(
  database: D1Database,
  entry: QueueOutboxEntry,
  pendingJobId?: string,
) {
  const selectSuffix =
    pendingJobId === undefined
      ? ""
      : " WHERE EXISTS (SELECT 1 FROM durable_jobs WHERE id = ? AND status = 'PENDING')";
  const bindings: unknown[] = [
    entry.id,
    entry.dedupeKey,
    entry.queueKind,
    entry.payloadJson,
    entry.availableAt,
    entry.publishingAt,
    entry.publishedAt,
    entry.createdAt,
    entry.updatedAt,
  ];
  if (pendingJobId !== undefined) bindings.push(pendingJobId);
  return database
    .prepare(
      `INSERT OR IGNORE INTO queue_outbox
        (id, dedupe_key, queue_kind, payload_json, available_at,
         publishing_at, published_at, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?${selectSuffix}`,
    )
    .bind(...bindings);
}

function insertJobStatement(
  database: D1Database,
  job: DurableJob,
  pendingJobId?: string,
) {
  const selectSuffix =
    pendingJobId === undefined
      ? ""
      : " WHERE EXISTS (SELECT 1 FROM durable_jobs WHERE id = ? AND status = 'PENDING')";
  const bindings: unknown[] = [
    job.id,
    job.kind,
    job.aggregateKey,
    job.payloadJson,
    job.status,
    job.createdAt,
    job.updatedAt,
    job.completedAt,
  ];
  if (pendingJobId !== undefined) bindings.push(pendingJobId);
  return database
    .prepare(
      `INSERT OR IGNORE INTO durable_jobs
        (id, kind, aggregate_key, payload_json, status, created_at,
         updated_at, completed_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?${selectSuffix}`,
    )
    .bind(...bindings);
}

function attemptUpdateStatement(
  database: D1Database,
  id: string,
  fields: AttemptUpdate,
) {
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
  if (fields.actualResult !== undefined) add("actual_result", fields.actualResult);
  if (fields.failureReason !== undefined) add("failure_reason", fields.failureReason);
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
  if (fields.runnerVersion !== undefined) add("runner_version", fields.runnerVersion);
  if (fields.systemErrorCode !== undefined) {
    add("system_error_code", fields.systemErrorCode);
  }
  if (assignments.length === 0) throw new Error("Attempt completion is empty");
  return database
    .prepare(
      `UPDATE test_attempts SET ${assignments.join(", ")}
       WHERE id = ? AND finished_at IS NULL`,
    )
    .bind(...values, id);
}

export class D1DurableWorkflowRepo
  implements DurableWorkflowRepo, OutboxRepo
{
  constructor(private readonly database: D1Database) {}

  async insertRunWithAttempt(
    value: TestRun,
    attempt: TestAttempt,
    outbox: QueueOutboxEntry,
  ): Promise<void> {
    await batch(this.database, [
      insertRunStatement(this.database, value),
      insertAttemptStatement(this.database, attempt),
      insertOutboxStatement(this.database, outbox),
    ]);
  }

  async recordAttemptCompletion(input: {
    attemptId: string;
    fields: AttemptUpdate;
    job: DurableJob;
  }): Promise<DurableJob> {
    const insertJob = this.database
      .prepare(
        `INSERT INTO durable_jobs
          (id, kind, aggregate_key, payload_json, status, created_at,
           updated_at, completed_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM test_attempts
           WHERE id = ? AND finished_at IS NULL
         )`,
      )
      .bind(
        input.job.id,
        input.job.kind,
        input.job.aggregateKey,
        input.job.payloadJson,
        input.job.status,
        input.job.createdAt,
        input.job.updatedAt,
        input.job.completedAt,
        input.attemptId,
      );
    try {
      const [result] = await batch(this.database, [
        insertJob,
        attemptUpdateStatement(this.database, input.attemptId, input.fields),
      ]);
      if ((result?.meta.changes ?? 0) === 1) return input.job;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
    const existing = await this.findJob(input.job.kind, input.job.aggregateKey);
    if (existing === null) {
      throw new Error("Attempt completion did not create a continuation");
    }
    return existing;
  }

  async findJob(
    kind: DurableJobKind,
    aggregateKey: string,
  ): Promise<DurableJob | null> {
    const row = await one<JobRow>(
      this.database
        .prepare("SELECT * FROM durable_jobs WHERE kind = ? AND aggregate_key = ?")
        .bind(kind, aggregateKey),
    );
    if (row === null) return null;
    const job = toJob(row);
    if (job.status === "PENDING" && !(await this.validatePendingJob(job))) {
      return null;
    }
    return job;
  }

  async listPendingJobs(
    kinds: DurableJobKind[],
    limit: number,
  ): Promise<DurableJob[]> {
    if (kinds.length === 0) return [];
    const jobs: DurableJob[] = [];
    const now = Date.now();
    while (jobs.length < limit) {
      const result = await this.database
        .prepare(
          `SELECT * FROM durable_jobs WHERE status = 'PENDING'
             AND quarantined_at IS NULL AND retry_at <= ?
             AND kind IN (${kinds.map(() => "?").join(", ")})
           ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .bind(now, ...kinds, limit - jobs.length)
        .all<JobRow>();
      if (result.results.length === 0) break;
      let quarantined = 0;
      for (const row of result.results) {
        const job = toJob(row);
        if (await this.validatePendingJob(job)) jobs.push(job);
        else quarantined += 1;
      }
      if (quarantined === 0 || jobs.length >= limit) break;
    }
    return jobs;
  }

  async scheduleFunctionalRetry(input: {
    jobId: string;
    runId: string;
    nextAttempt: TestAttempt;
    outbox: QueueOutboxEntry;
    at: number;
  }): Promise<void> {
    const attempt = input.nextAttempt;
    await batch(this.database, [
      this.database
        .prepare(
          `INSERT OR IGNORE INTO test_attempts
            (id, test_run_id, attempt_index, status, retry_delay_seconds,
             queued_at, started_at, finished_at, duration_ms, summary,
             expected_result, actual_result, failure_reason, visited_urls_json,
             console_errors_json, network_errors_json, token_usage, model_name,
             runner_version, system_error_code, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM durable_jobs WHERE id = ? AND status = 'PENDING'
           )`,
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
          input.jobId,
        ),
      this.database
        .prepare(
          `UPDATE test_runs
           SET attempt_count = (SELECT COUNT(*) FROM test_attempts WHERE test_run_id = ?)
           WHERE id = ? AND EXISTS (
             SELECT 1 FROM durable_jobs WHERE id = ? AND status = 'PENDING'
           )`,
        )
        .bind(input.runId, input.runId, input.jobId),
      insertOutboxStatement(this.database, input.outbox, input.jobId),
      this.completeJobStatement(input.jobId, input.at),
    ]);
  }

  async scheduleInfrastructureRetry(input: {
    jobId: string;
    runId: string;
    attemptId: string;
    attemptCount: number;
    queuedAt: number;
    artifactIds: string[];
    outbox: QueueOutboxEntry;
    at: number;
  }): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          `DELETE FROM run_steps WHERE attempt_id = ? AND EXISTS (
             SELECT 1 FROM durable_jobs WHERE id = ? AND status = 'PENDING'
           )`,
        )
        .bind(input.attemptId, input.jobId),
    ];
    if (input.artifactIds.length > 0) {
      statements.push(
        this.database
          .prepare(
            `DELETE FROM run_artifacts
             WHERE id IN (${input.artifactIds.map(() => "?").join(", ")})
               AND EXISTS (
                 SELECT 1 FROM durable_jobs WHERE id = ? AND status = 'PENDING'
               )`,
          )
          .bind(...input.artifactIds, input.jobId),
      );
    }
    statements.push(
      this.database
        .prepare(
          `UPDATE test_runs
           SET infra_attempts = infra_attempts + 1, attempt_count = ?
           WHERE id = ? AND EXISTS (
             SELECT 1 FROM durable_jobs WHERE id = ? AND status = 'PENDING'
           )`,
        )
        .bind(input.attemptCount, input.runId, input.jobId),
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
           WHERE id = ? AND EXISTS (
             SELECT 1 FROM durable_jobs WHERE id = ? AND status = 'PENDING'
           )`,
        )
        .bind(input.queuedAt, input.attemptId, input.jobId),
      insertOutboxStatement(this.database, input.outbox, input.jobId),
      this.completeJobStatement(input.jobId, input.at),
    );
    await batch(this.database, statements);
  }

  async finalizeRun(input: {
    jobId: string;
    runId: string;
    changes: import("../../domain/browser_tests/repo").RunFinalize;
    finalizationJob: DurableJob;
    at: number;
  }): Promise<void> {
    await batch(this.database, [
      this.database
        .prepare(
          `UPDATE test_runs
           SET status = ?, finished_at = ?, duration_ms = ?, attempt_count = ?,
               passed_after_retry = ?, billable = ?,
               incident_id = CASE WHEN ? = 1 THEN ? ELSE incident_id END
           WHERE id = ? AND EXISTS (
             SELECT 1 FROM durable_jobs WHERE id = ? AND status = 'PENDING'
           )`,
        )
        .bind(
          input.changes.status,
          input.changes.finishedAt,
          input.changes.durationMs,
          input.changes.attemptCount,
          input.changes.passedAfterRetry ? 1 : 0,
          input.changes.billable ? 1 : 0,
          input.changes.incidentId === undefined ? 0 : 1,
          input.changes.incidentId ?? null,
          input.runId,
          input.jobId,
        ),
      insertJobStatement(this.database, input.finalizationJob, input.jobId),
      this.completeJobStatement(input.jobId, input.at),
    ]);
  }

  async insertDeliveryWithOutbox(input: {
    delivery: NotificationDelivery;
    dedupeKey: string;
    outbox: QueueOutboxEntry;
  }): Promise<{ deliveryId: string; outboxId: string; inserted: boolean }> {
    const delivery = input.delivery;
    try {
      await batch(this.database, [
        this.database
          .prepare(
            `INSERT INTO notification_deliveries
              (id, workspace_id, incident_id, notification_channel_id,
               event_type, status, provider_message_id, attempt_count,
               error_sanitized, sent_at, created_at, dedupe_key, processing_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .bind(
            delivery.id,
            delivery.workspaceId,
            delivery.incidentId,
            delivery.notificationChannelId,
            delivery.eventType,
            delivery.status,
            delivery.providerMessageId,
            delivery.attemptCount,
            delivery.errorSanitized,
            delivery.sentAt,
            delivery.createdAt,
            input.dedupeKey,
          ),
        insertOutboxStatement(this.database, input.outbox),
      ]);
      return {
        deliveryId: delivery.id,
        outboxId: input.outbox.id,
        inserted: true,
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const [deliveryRow, outboxRow] = await Promise.all([
        one<{ id: string }>(
          this.database
            .prepare("SELECT id FROM notification_deliveries WHERE dedupe_key = ?")
            .bind(input.dedupeKey),
        ),
        one<{ id: string }>(
          this.database
            .prepare("SELECT id FROM queue_outbox WHERE dedupe_key = ?")
            .bind(input.outbox.dedupeKey),
        ),
      ]);
      if (deliveryRow === null || outboxRow === null) throw error;
      return {
        deliveryId: deliveryRow.id,
        outboxId: outboxRow.id,
        inserted: false,
      };
    }
  }

  async claimCheckExecution(input: {
    cycleId: string;
    attemptIndex: number;
    claimToken: string;
    claimedAt: number;
    staleBefore: number;
  }): Promise<"claimed" | "busy" | "completed"> {
    const claimed = await one<{ completed_at: number | null }>(
      this.database
        .prepare(
          `INSERT INTO check_execution_claims
            (cycle_id, attempt_index, claim_token, claimed_at, completed_at)
           VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(cycle_id, attempt_index) DO UPDATE SET
             claim_token = excluded.claim_token,
             claimed_at = excluded.claimed_at
           WHERE check_execution_claims.completed_at IS NULL
             AND check_execution_claims.claimed_at <= ?
           RETURNING completed_at`,
        )
        .bind(
          input.cycleId,
          input.attemptIndex,
          input.claimToken,
          input.claimedAt,
          input.staleBefore,
        ),
    );
    if (claimed !== null) return "claimed";
    const existing = await one<{ completed_at: number | null }>(
      this.database
        .prepare(
          `SELECT completed_at FROM check_execution_claims
           WHERE cycle_id = ? AND attempt_index = ?`,
        )
        .bind(input.cycleId, input.attemptIndex),
    );
    if (existing === null || existing.completed_at === null) return "busy";
    return "completed";
  }

  async releaseCheckExecution(input: {
    cycleId: string;
    attemptIndex: number;
    claimToken: string;
  }): Promise<void> {
    await run(
      this.database
        .prepare(
          `DELETE FROM check_execution_claims
           WHERE cycle_id = ? AND attempt_index = ? AND claim_token = ?
             AND completed_at IS NULL`,
        )
        .bind(input.cycleId, input.attemptIndex, input.claimToken),
    );
  }

  async insertCheckWithJob(
    check: UptimeCheck,
    job: DurableJob,
    claimToken: string,
  ): Promise<"inserted" | "duplicate"> {
    try {
      const results = await batch(this.database, [
        this.database
          .prepare(
            `INSERT INTO uptime_checks
              (id, workspace_id, uptime_monitor_id, cycle_id, attempt_index,
               status, http_status, response_time_ms, failure_reason,
               response_excerpt, checked_at, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM check_execution_claims
               WHERE cycle_id = ? AND attempt_index = ? AND claim_token = ?
                 AND completed_at IS NULL
             )`,
          )
          .bind(
            check.id,
            check.workspaceId,
            check.uptimeMonitorId,
            check.cycleId,
            check.attemptIndex,
            check.status,
            check.httpStatus,
            check.responseTimeMs,
            check.failureReason,
            check.responseExcerpt,
            check.checkedAt,
            check.createdAt,
            check.cycleId,
            check.attemptIndex,
            claimToken,
          ),
        this.database
          .prepare(
            `INSERT INTO durable_jobs
              (id, kind, aggregate_key, payload_json, status, created_at,
               updated_at, completed_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM check_execution_claims
               WHERE cycle_id = ? AND attempt_index = ? AND claim_token = ?
                 AND completed_at IS NULL
             )`,
          )
          .bind(
            job.id,
            job.kind,
            job.aggregateKey,
            job.payloadJson,
            job.status,
            job.createdAt,
            job.updatedAt,
            job.completedAt,
            check.cycleId,
            check.attemptIndex,
            claimToken,
          ),
        this.database
          .prepare(
            `UPDATE check_execution_claims SET completed_at = ?
             WHERE cycle_id = ? AND attempt_index = ? AND claim_token = ?
               AND completed_at IS NULL`,
          )
          .bind(check.checkedAt, check.cycleId, check.attemptIndex, claimToken),
      ]);
      if (
        (results[0]?.meta.changes ?? 0) !== 1 ||
        (results[1]?.meta.changes ?? 0) !== 1 ||
        (results[2]?.meta.changes ?? 0) !== 1
      ) {
        return "duplicate";
      }
      return "inserted";
    } catch (error) {
      if (isUniqueConstraintError(error)) return "duplicate";
      throw error;
    }
  }

  async openMonitorCycleWithOutbox(input: {
    monitorId: string;
    cycleId: string;
    at: number;
    outbox: QueueOutboxEntry;
  }): Promise<boolean> {
    const [opened] = await batch(this.database, [
      this.database
        .prepare(
          `UPDATE uptime_monitors
           SET current_cycle_id = ?, cycle_started_at = ?, updated_at = ?
           WHERE id = ? AND current_cycle_id IS NULL AND deleted_at IS NULL`,
        )
        .bind(input.cycleId, input.at, input.at, input.monitorId),
      this.database
        .prepare(
          `INSERT INTO queue_outbox
            (id, dedupe_key, queue_kind, payload_json, available_at,
             publishing_at, published_at, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM uptime_monitors
             WHERE id = ? AND current_cycle_id = ? AND cycle_started_at = ?
           )`,
        )
        .bind(
          input.outbox.id,
          input.outbox.dedupeKey,
          input.outbox.queueKind,
          input.outbox.payloadJson,
          input.outbox.availableAt,
          input.outbox.publishingAt,
          input.outbox.publishedAt,
          input.outbox.createdAt,
          input.outbox.updatedAt,
          input.monitorId,
          input.cycleId,
          input.at,
        ),
    ]);
    return (opened?.meta.changes ?? 0) === 1;
  }

  async scheduleCheckRetry(input: {
    jobId: string;
    outbox: QueueOutboxEntry;
    at: number;
  }): Promise<void> {
    await batch(this.database, [
      insertOutboxStatement(this.database, input.outbox, input.jobId),
      this.completeJobStatement(input.jobId, input.at),
    ]);
  }

  async completeJob(jobId: string, at: number): Promise<void> {
    await run(this.completeJobStatement(jobId, at));
  }

  async claimById(
    id: string,
    claimedAt: number,
    staleBefore: number,
  ): Promise<QueueOutboxEntry | null> {
    const row = await one<OutboxRow>(
      this.database
        .prepare(
          `UPDATE queue_outbox SET publishing_at = ?, updated_at = ?
           WHERE id = ? AND published_at IS NULL AND quarantined_at IS NULL
             AND (publishing_at IS NULL OR publishing_at <= ?)
           RETURNING *`,
        )
        .bind(claimedAt, claimedAt, id, staleBefore),
    );
    return row === null ? null : toOutbox(row);
  }

  async listPending(
    limit: number,
    availableBefore: number,
    staleBefore: number,
  ): Promise<QueueOutboxEntry[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM queue_outbox
         WHERE published_at IS NULL AND available_at <= ?
           AND quarantined_at IS NULL
           AND (publishing_at IS NULL OR publishing_at <= ?)
         ORDER BY available_at ASC, created_at ASC, id ASC LIMIT ?`,
      )
      .bind(availableBefore, staleBefore, limit)
      .all<OutboxRow>();
    return result.results.map(toOutbox);
  }

  async markPublished(id: string, publishedAt: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE queue_outbox
           SET published_at = ?, publishing_at = NULL, updated_at = ?
           WHERE id = ? AND published_at IS NULL`,
        )
        .bind(publishedAt, publishedAt, id),
    );
  }

  async releaseClaim(id: string, at: number): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE queue_outbox SET publishing_at = NULL, updated_at = ?
           WHERE id = ? AND published_at IS NULL`,
        )
        .bind(at, id),
    );
  }

  async insertOutbox(entry: QueueOutboxEntry): Promise<QueueOutboxEntry> {
    await run(insertOutboxStatement(this.database, entry));
    const row = await one<OutboxRow>(
      this.database
        .prepare("SELECT * FROM queue_outbox WHERE dedupe_key = ?")
        .bind(entry.dedupeKey),
    );
    if (row === null) throw new Error("Outbox insert did not persist an entry");
    return toOutbox(row);
  }

  async quarantineOutbox(
    id: string,
    at: number,
    reason: string,
  ): Promise<void> {
    await run(
      this.database
        .prepare(
          `UPDATE queue_outbox
           SET quarantined_at = ?, publishing_at = NULL, updated_at = ?,
               last_error = ?
           WHERE id = ? AND published_at IS NULL`,
        )
        .bind(at, at, reason.slice(0, 300), id),
    );
  }

  async recordOutboxFailure(
    id: string,
    at: number,
    reason: string,
  ): Promise<"retry" | "quarantined"> {
    const row = await one<{ quarantined_at: number | null }>(
      this.database
        .prepare(
          `UPDATE queue_outbox
           SET failure_count = failure_count + 1,
               quarantined_at = CASE
                 WHEN failure_count + 1 >= 8 THEN ? ELSE NULL END,
               available_at = CASE failure_count
                 WHEN 0 THEN available_at
                 WHEN 1 THEN MAX(available_at, ? + 30000)
                 WHEN 2 THEN MAX(available_at, ? + 60000)
                 WHEN 3 THEN MAX(available_at, ? + 120000)
                 ELSE MAX(available_at, ? + 300000) END,
               publishing_at = NULL, updated_at = ?, last_error = ?
           WHERE id = ? AND published_at IS NULL
           RETURNING quarantined_at`,
        )
        .bind(
          at,
          at,
          at,
          at,
          at,
          at,
          reason.slice(0, 300),
          id,
        ),
    );
    return row?.quarantined_at === null ? "retry" : "quarantined";
  }

  async purgePublished(before: number, limit: number): Promise<number> {
    const result = await run(
      this.database
        .prepare(
          `DELETE FROM queue_outbox WHERE id IN (
             SELECT id FROM queue_outbox
             WHERE published_at IS NOT NULL AND published_at < ?
             ORDER BY published_at ASC, id ASC LIMIT ?
           )`,
        )
        .bind(before, limit),
    );
    return result.meta.changes;
  }

  async purgeCompleted(before: number, limit: number): Promise<number> {
    const result = await run(
      this.database
        .prepare(
          `DELETE FROM durable_jobs WHERE id IN (
             SELECT id FROM durable_jobs
             WHERE status = 'COMPLETED' AND completed_at < ?
             ORDER BY completed_at ASC, id ASC LIMIT ?
           )`,
        )
        .bind(before, limit),
    );
    return result.meta.changes;
  }

  private completeJobStatement(jobId: string, at: number) {
    return this.database
      .prepare(
        `UPDATE durable_jobs
         SET status = 'COMPLETED', updated_at = ?, completed_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .bind(at, at, jobId);
  }

  private async validatePendingJob(job: DurableJob): Promise<boolean> {
    const parsed = validateDurableJobPayload(job);
    let reason = parsed.success ? null : parsed.reason;
    if (parsed.success) {
      const payload = parsed.value;
      if (job.kind === "ATTEMPT_CONTINUATION") {
        const attemptId = payload.attemptId as string;
        const runId = payload.runId as string;
        if (!job.aggregateKey.startsWith(`${attemptId}:`)) {
          reason = "attempt continuation aggregate does not match payload";
        } else {
          const linked = await one<{ present: number }>(
            this.database
              .prepare(
                `SELECT 1 AS present FROM test_attempts
                 WHERE id = ? AND test_run_id = ? LIMIT 1`,
              )
              .bind(attemptId, runId),
          );
          if (linked === null) reason = "attempt continuation relation is invalid";
        }
      } else if (job.kind === "RUN_FINALIZATION") {
        const runId = payload.runId as string;
        if (job.aggregateKey !== runId) {
          reason = "run finalization aggregate does not match payload";
        } else {
          const linked = await one<{ present: number }>(
            this.database
              .prepare("SELECT 1 AS present FROM test_runs WHERE id = ? LIMIT 1")
              .bind(runId),
          );
          if (linked === null) reason = "run finalization relation is invalid";
        }
      } else {
        const checkId = payload.checkId as string;
        const linked = await one<{ present: number }>(
          this.database
            .prepare(
              `SELECT 1 AS present FROM uptime_checks
               WHERE id = ? AND workspace_id = ? AND uptime_monitor_id = ?
                 AND cycle_id = ? AND attempt_index = ?
               LIMIT 1`,
            )
            .bind(
              checkId,
              payload.workspaceId,
              payload.monitorId,
              payload.cycleId,
              payload.attemptIndex,
            ),
        );
        if (job.aggregateKey !== checkId || linked === null) {
          reason = "check continuation relation is invalid";
        }
      }
    }
    if (reason === null) return true;
    const at = Date.now();
    await run(
      this.database
        .prepare(
          `UPDATE durable_jobs
           SET quarantined_at = ?, failure_count = failure_count + 1,
               updated_at = ?, last_error = ?
           WHERE id = ? AND status = 'PENDING' AND quarantined_at IS NULL`,
        )
        .bind(at, at, reason.slice(0, 300), job.id),
    );
    platformAlert("durable_job_quarantined", {
      jobId: job.id,
      kind: job.kind,
      reason,
    });
    return false;
  }
}

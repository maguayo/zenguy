import type {
  WorkspaceDeletionClaim,
  WorkspaceDeletionRepo,
  WorkspaceDeletionStage,
} from "../../domain/workspaces/deletion";
import { all, batch, one } from "./d1";

interface DeletionClaimRow {
  id: string;
  deletion_state: WorkspaceDeletionStage;
  deletion_attempt_count: number;
}

function jsonField(field: string): string {
  return `CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.${field}') END`;
}

const queueWorkspacePredicate = `(
  ${jsonField("workspaceId")} = ?
  OR ${jsonField("runId")} IN (
    SELECT id FROM test_runs WHERE workspace_id = ?
  )
  OR ${jsonField("monitorId")} IN (
    SELECT id FROM uptime_monitors WHERE workspace_id = ?
  )
  OR ${jsonField("deliveryId")} IN (
    SELECT id FROM notification_deliveries WHERE workspace_id = ?
  )
)`;

const queueWorkspaceBindings = (workspaceId: string): string[] => [
  workspaceId,
  workspaceId,
  workspaceId,
  workspaceId,
];

export class D1WorkspaceDeletionRepo implements WorkspaceDeletionRepo {
  constructor(private readonly database: D1Database) {}

  async requestTombstone(
    workspaceId: string,
    requestedAt: number,
  ): Promise<boolean> {
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          `UPDATE workspaces
           SET deletion_state = 'DELETION_PENDING',
               deletion_requested_at = ?,
               deletion_retry_at = ?,
               deletion_attempt_count = 0,
               deletion_last_error = NULL,
               deletion_processing_at = NULL,
               updated_at = ?
           WHERE id = ? AND deleted_at IS NULL AND deletion_state = 'ACTIVE'`,
        )
        .bind(requestedAt, requestedAt, requestedAt, workspaceId),
      this.database
        .prepare(
          `UPDATE notification_channels
           SET enabled = 0, updated_at = ?
           WHERE workspace_id = ?`,
        )
        .bind(requestedAt, workspaceId),
      this.database
        .prepare(
          `UPDATE workspace_invitations
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE workspace_id = ?`,
        )
        .bind(requestedAt, workspaceId),
      this.database
        .prepare(
          `UPDATE workspace_api_keys
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE workspace_id = ?`,
        )
        .bind(requestedAt, workspaceId),
      this.database
        .prepare(
          `UPDATE browser_tests
           SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
           WHERE workspace_id = ?`,
        )
        .bind(requestedAt, requestedAt, workspaceId),
      this.database
        .prepare(
          `UPDATE uptime_monitors
           SET deleted_at = COALESCE(deleted_at, ?),
               updated_at = ?
           WHERE workspace_id = ?`,
        )
        .bind(requestedAt, requestedAt, workspaceId),
      this.database
        .prepare(
          `UPDATE usage_events
           SET billable = 0, reversed_at = COALESCE(reversed_at, ?)
           WHERE workspace_id = ? AND test_run_id IN (
             SELECT id FROM test_runs
             WHERE workspace_id = ? AND status IN ('QUEUED', 'RUNNING')
           )`,
        )
        .bind(requestedAt, workspaceId, workspaceId),
      this.database
        .prepare(
          `UPDATE test_attempts
           SET status = 'SYSTEM_ERROR',
               finished_at = COALESCE(finished_at, ?),
               failure_reason = 'Workspace deletion requested',
               system_error_code = 'WORKSPACE_DELETED'
           WHERE status IN ('QUEUED', 'STARTING', 'RUNNING')
             AND test_run_id IN (
               SELECT id FROM test_runs WHERE workspace_id = ?
             )`,
        )
        .bind(requestedAt, workspaceId),
      this.database
        .prepare(
          `UPDATE test_runs
           SET status = 'SYSTEM_ERROR',
               finished_at = COALESCE(finished_at, ?),
               billable = 0
           WHERE workspace_id = ? AND status IN ('QUEUED', 'RUNNING')`,
        )
        .bind(requestedAt, workspaceId),
      this.database
        .prepare(
          `UPDATE notification_deliveries
           SET status = 'FAILED',
               dispatch_state = 'CONFIRMED',
               dispatch_token = NULL,
               processing_at = NULL,
               error_sanitized = 'workspace deletion requested'
           WHERE workspace_id = ? AND status = 'PENDING'`,
        )
        .bind(workspaceId),
      this.database
        .prepare(
          `UPDATE workspace_alert_settings
           SET paid_channels_enabled = 0, updated_at = ?
           WHERE workspace_id = ?`,
        )
        .bind(requestedAt, workspaceId),
      this.database
        .prepare(
          `UPDATE incidents
           SET status = 'RESOLVED',
               resolved_at = COALESCE(resolved_at, ?),
               last_event_at = CASE WHEN last_event_at < ? THEN ? ELSE last_event_at END
           WHERE workspace_id = ? AND status = 'OPEN'`,
        )
        .bind(requestedAt, requestedAt, requestedAt, workspaceId),
      this.database
        .prepare("DELETE FROM pending_overage_periods WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM paddle_checkout_intents WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare(
          `DELETE FROM check_execution_claims
           WHERE cycle_id IN (
             SELECT current_cycle_id FROM uptime_monitors
             WHERE workspace_id = ? AND current_cycle_id IS NOT NULL
             UNION
             SELECT cycle_id FROM uptime_checks WHERE workspace_id = ?
           )`,
        )
        .bind(workspaceId, workspaceId),
      this.database
        .prepare(
          `UPDATE uptime_monitors
           SET current_cycle_id = NULL, cycle_started_at = NULL
           WHERE workspace_id = ?`,
        )
        .bind(workspaceId),
      this.database
        .prepare(
          `UPDATE queue_outbox
           SET quarantined_at = ?,
               publishing_at = NULL,
               last_error = 'workspace deletion requested',
               updated_at = ?
           WHERE published_at IS NULL AND quarantined_at IS NULL
             AND ${queueWorkspacePredicate}`,
        )
        .bind(requestedAt, requestedAt, ...queueWorkspaceBindings(workspaceId)),
      this.database
        .prepare(
          `UPDATE durable_jobs
           SET quarantined_at = ?,
               last_error = 'workspace deletion requested',
               updated_at = ?
           WHERE status = 'PENDING' AND quarantined_at IS NULL
             AND ${queueWorkspacePredicate}`,
        )
        .bind(requestedAt, requestedAt, ...queueWorkspaceBindings(workspaceId)),
    ];
    const [tombstone] = await batch(this.database, statements);
    return (tombstone?.meta.changes ?? 0) === 1;
  }

  async claimDue(input: {
    now: number;
    staleBefore: number;
    workspaceId?: string;
  }): Promise<WorkspaceDeletionClaim | null> {
    const workspaceClause = input.workspaceId === undefined ? "" : "AND id = ?";
    const bindings: unknown[] = [input.now, input.now, input.staleBefore];
    if (input.workspaceId !== undefined) bindings.push(input.workspaceId);
    const row = await one<DeletionClaimRow>(
      this.database
        .prepare(
          `UPDATE workspaces
           SET deletion_state = CASE
                 WHEN deletion_state = 'DELETION_PENDING'
                   THEN 'CANCELLATION_PENDING'
                 ELSE deletion_state
               END,
               deletion_processing_at = ?
           WHERE id = (
             SELECT id FROM workspaces
             WHERE deletion_state IN (
                 'DELETION_PENDING', 'CANCELLATION_PENDING', 'PURGE_PENDING'
               )
               AND COALESCE(deletion_retry_at, 0) <= ?
               AND (deletion_processing_at IS NULL OR deletion_processing_at <= ?)
               ${workspaceClause}
             ORDER BY COALESCE(deletion_retry_at, 0) ASC, id ASC
             LIMIT 1
           )
           RETURNING id, deletion_state, deletion_attempt_count`,
        )
        .bind(...bindings),
    );
    if (row === null) return null;
    return {
      workspaceId: row.id,
      stage: row.deletion_state,
      attemptCount: row.deletion_attempt_count,
    };
  }

  async markCancellationSucceeded(workspaceId: string, at: number): Promise<void> {
    await this.database
      .prepare(
        `UPDATE workspaces
         SET deletion_state = 'PURGE_PENDING',
             deleted_at = COALESCE(deleted_at, ?),
             deletion_retry_at = ?,
             deletion_attempt_count = 0,
             deletion_last_error = NULL,
             deletion_processing_at = NULL,
             updated_at = ?
         WHERE id = ? AND deletion_state = 'CANCELLATION_PENDING'`,
      )
      .bind(at, at, at, workspaceId)
      .run();
  }

  async recordFailure(input: {
    workspaceId: string;
    stage: WorkspaceDeletionStage;
    failedAt: number;
    retryAt: number;
    error: string;
  }): Promise<void> {
    await this.database
      .prepare(
        `UPDATE workspaces
         SET deletion_retry_at = ?,
             deletion_attempt_count = deletion_attempt_count + 1,
             deletion_last_error = ?,
             deletion_processing_at = NULL,
             updated_at = ?
         WHERE id = ? AND deletion_state = ?`,
      )
      .bind(
        input.retryAt,
        input.error,
        input.failedAt,
        input.workspaceId,
        input.stage,
      )
      .run();
  }

  async listArtifactStorageKeys(workspaceId: string): Promise<string[]> {
    const rows = await all<{ storage_key: string }>(
      this.database
        .prepare(
          `SELECT storage_key FROM run_artifacts
           WHERE workspace_id = ? ORDER BY id ASC`,
        )
        .bind(workspaceId),
    );
    return [...new Set(rows.map((row) => row.storage_key))];
  }

  async purgeAndAnonymize(workspaceId: string, at: number): Promise<void> {
    const eligible = await one<{ eligible: number }>(
      this.database
        .prepare(
          `SELECT EXISTS(
             SELECT 1 FROM workspaces
             WHERE id = ? AND deletion_state = 'PURGE_PENDING'
           ) AS eligible`,
        )
        .bind(workspaceId),
    );
    if (eligible?.eligible !== 1) return;
    const queueBindings = queueWorkspaceBindings(workspaceId);
    await batch(this.database, [
      this.database
        .prepare(`DELETE FROM queue_outbox WHERE ${queueWorkspacePredicate}`)
        .bind(...queueBindings),
      this.database
        .prepare(`DELETE FROM durable_jobs WHERE ${queueWorkspacePredicate}`)
        .bind(...queueBindings),
      this.database
        .prepare(
          `DELETE FROM check_execution_claims
           WHERE cycle_id IN (
             SELECT cycle_id FROM uptime_checks WHERE workspace_id = ?
           )`,
        )
        .bind(workspaceId),
      this.database
        .prepare(
          `DELETE FROM browser_test_channels
           WHERE browser_test_id IN (
             SELECT id FROM browser_tests WHERE workspace_id = ?
           ) OR notification_channel_id IN (
             SELECT id FROM notification_channels WHERE workspace_id = ?
           )`,
        )
        .bind(workspaceId, workspaceId),
      this.database
        .prepare(
          `DELETE FROM uptime_monitor_channels
           WHERE uptime_monitor_id IN (
             SELECT id FROM uptime_monitors WHERE workspace_id = ?
           ) OR notification_channel_id IN (
             SELECT id FROM notification_channels WHERE workspace_id = ?
           )`,
        )
        .bind(workspaceId, workspaceId),
      this.database
        .prepare(
          `DELETE FROM run_steps WHERE attempt_id IN (
             SELECT a.id FROM test_attempts a
             JOIN test_runs r ON r.id = a.test_run_id
             WHERE r.workspace_id = ?
           )`,
        )
        .bind(workspaceId),
      this.database
        .prepare(
          `DELETE FROM test_attempts WHERE test_run_id IN (
             SELECT id FROM test_runs WHERE workspace_id = ?
           )`,
        )
        .bind(workspaceId),
      this.database
        .prepare(
          `DELETE FROM incident_events WHERE incident_id IN (
             SELECT id FROM incidents WHERE workspace_id = ?
           )`,
        )
        .bind(workspaceId),
      this.database
        .prepare(
          `UPDATE subscription_grants SET redeemed_workspace_id = NULL
           WHERE redeemed_workspace_id = ?`,
        )
        .bind(workspaceId),
      this.database
        .prepare(
          `UPDATE audit_logs
           SET actor_user_id = NULL,
               resource_id = NULL,
               metadata_json = '{"retainedFor":"security_and_legal"}',
               ip = NULL
           WHERE workspace_id = ?`,
        )
        .bind(workspaceId),
      this.database
        .prepare(
          `UPDATE usage_events
           SET test_run_id = 'deleted:' || id,
               idempotency_key = 'retained:' || id
           WHERE workspace_id = ?`,
        )
        .bind(workspaceId),
      this.database
        .prepare(
          `UPDATE subscriptions
           SET provider_customer_id = NULL,
               status = 'CANCELED',
               cancel_at_period_end = 0,
               update_payment_url = NULL,
               cancel_url = NULL,
               updated_at = ?
           WHERE workspace_id = ?`,
        )
        .bind(at, workspaceId),
      this.database
        .prepare(
          `UPDATE alert_credit_entries
           SET delivery_id = NULL,
               description = 'Retained financial ledger entry',
               idempotency_key = 'retained:' || id
           WHERE workspace_id = ?`,
        )
        .bind(workspaceId),
      this.database
        .prepare(
          `DELETE FROM rate_limit_windows
           WHERE rate_key LIKE '%' || ? || '%'`,
        )
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM paddle_checkout_intents WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM pending_overage_periods WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM workspace_alert_settings WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM alert_credit_balances WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM notification_deliveries WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM run_artifacts WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM activity_events WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM uptime_checks WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM test_runs WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM incidents WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM browser_tests WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM uptime_monitors WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM notification_channels WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM workspace_secrets WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare(
          "DELETE FROM workspace_data_encryption_keys WHERE workspace_id = ?",
        )
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM workspace_invitations WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare("DELETE FROM workspace_members WHERE workspace_id = ?")
        .bind(workspaceId),
      this.database
        .prepare(
          `UPDATE workspaces
           SET name = 'Deleted workspace',
               slug = 'deleted-' || id,
               timezone = 'UTC',
               owner_user_id = 'deleted:' || id,
               deletion_state = 'COMPLETED',
               deletion_retry_at = NULL,
               deletion_attempt_count = 0,
               deletion_last_error = NULL,
               deletion_processing_at = NULL,
               deletion_completed_at = ?,
               updated_at = ?
           WHERE id = ? AND deletion_state = 'PURGE_PENDING'`,
        )
        .bind(at, at, workspaceId),
    ]);
  }

  async isOperational(workspaceId: string): Promise<boolean> {
    const row = await one<{ operational: number }>(
      this.database
        .prepare(
          `SELECT EXISTS(
             SELECT 1 FROM workspaces
             WHERE id = ? AND deleted_at IS NULL AND deletion_state = 'ACTIVE'
           ) AS operational`,
        )
        .bind(workspaceId),
    );
    return row?.operational === 1;
  }
}

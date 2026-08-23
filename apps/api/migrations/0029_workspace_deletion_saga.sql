-- Durable workspace deletion. A non-ACTIVE state is a tombstone: request
-- handlers, schedulers and queue consumers must treat the workspace as gone
-- even while Paddle cancellation or storage cleanup is being retried.
ALTER TABLE workspaces ADD COLUMN deletion_state TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (deletion_state IN (
    'ACTIVE',
    'DELETION_PENDING',
    'CANCELLATION_PENDING',
    'PURGE_PENDING',
    'COMPLETED'
  ));
ALTER TABLE workspaces ADD COLUMN deletion_requested_at INTEGER;
ALTER TABLE workspaces ADD COLUMN deletion_retry_at INTEGER;
ALTER TABLE workspaces ADD COLUMN deletion_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN deletion_last_error TEXT;
ALTER TABLE workspaces ADD COLUMN deletion_processing_at INTEGER;
ALTER TABLE workspaces ADD COLUMN deletion_completed_at INTEGER;

CREATE INDEX idx_workspaces_deletion_due
  ON workspaces(deletion_state, deletion_retry_at, deletion_processing_at)
  WHERE deletion_state != 'ACTIVE' AND deletion_state != 'COMPLETED';

-- Previously soft-deleted workspaces become recoverable saga work. Re-run
-- Paddle cancellation before purging because the old flow could swallow a
-- provider failure after setting deleted_at.
UPDATE workspaces
SET deletion_state = 'CANCELLATION_PENDING',
    deletion_requested_at = COALESCE(deleted_at, updated_at),
    deletion_retry_at = 0,
    deletion_attempt_count = 0
WHERE deleted_at IS NOT NULL;

-- Quiesce legacy tombstones during migration. New tombstones use the same
-- statements atomically in D1WorkspaceDeletionRepo.
UPDATE notification_channels
SET enabled = 0,
    updated_at = COALESCE(
      (SELECT w.deletion_requested_at FROM workspaces w
       WHERE w.id = notification_channels.workspace_id),
      updated_at
    )
WHERE workspace_id IN (
  SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
);

UPDATE workspace_invitations
SET revoked_at = COALESCE(
  revoked_at,
  (SELECT w.deletion_requested_at FROM workspaces w
   WHERE w.id = workspace_invitations.workspace_id)
)
WHERE workspace_id IN (
  SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
);

UPDATE workspace_api_keys
SET revoked_at = COALESCE(
  revoked_at,
  (SELECT w.deletion_requested_at FROM workspaces w
   WHERE w.id = workspace_api_keys.workspace_id)
)
WHERE workspace_id IN (
  SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
);

UPDATE browser_tests
SET deleted_at = COALESCE(
  deleted_at,
  (SELECT w.deletion_requested_at FROM workspaces w
   WHERE w.id = browser_tests.workspace_id)
),
    updated_at = COALESCE(
      (SELECT w.deletion_requested_at FROM workspaces w
       WHERE w.id = browser_tests.workspace_id),
      updated_at
    )
WHERE workspace_id IN (
  SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
);

DELETE FROM check_execution_claims
WHERE cycle_id IN (
  SELECT m.current_cycle_id
  FROM uptime_monitors m JOIN workspaces w ON w.id = m.workspace_id
  WHERE w.deletion_state != 'ACTIVE' AND m.current_cycle_id IS NOT NULL
  UNION
  SELECT c.cycle_id
  FROM uptime_checks c JOIN workspaces w ON w.id = c.workspace_id
  WHERE w.deletion_state != 'ACTIVE'
);

UPDATE uptime_monitors
SET deleted_at = COALESCE(
  deleted_at,
  (SELECT w.deletion_requested_at FROM workspaces w
   WHERE w.id = uptime_monitors.workspace_id)
),
    current_cycle_id = NULL,
    cycle_started_at = NULL,
    updated_at = COALESCE(
      (SELECT w.deletion_requested_at FROM workspaces w
       WHERE w.id = uptime_monitors.workspace_id),
      updated_at
    )
WHERE workspace_id IN (
  SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
);

UPDATE test_attempts
SET status = 'SYSTEM_ERROR',
    finished_at = COALESCE(
      finished_at,
      (SELECT w.deletion_requested_at
       FROM test_runs r JOIN workspaces w ON w.id = r.workspace_id
       WHERE r.id = test_attempts.test_run_id)
    ),
    failure_reason = 'Workspace deletion requested',
    system_error_code = 'WORKSPACE_DELETED'
WHERE status IN ('QUEUED', 'STARTING', 'RUNNING')
  AND test_run_id IN (
    SELECT r.id FROM test_runs r JOIN workspaces w ON w.id = r.workspace_id
    WHERE w.deletion_state != 'ACTIVE'
  );

UPDATE test_runs
SET status = 'SYSTEM_ERROR',
    finished_at = COALESCE(
      finished_at,
      (SELECT w.deletion_requested_at FROM workspaces w
       WHERE w.id = test_runs.workspace_id)
    ),
    billable = 0
WHERE status IN ('QUEUED', 'RUNNING')
  AND workspace_id IN (
    SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
  );

UPDATE notification_deliveries
SET status = 'FAILED',
    processing_at = NULL,
    error_sanitized = 'workspace deletion requested'
WHERE status = 'PENDING'
  AND workspace_id IN (
  SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
);

UPDATE queue_outbox
SET quarantined_at = COALESCE(quarantined_at, updated_at),
    publishing_at = NULL,
    last_error = 'workspace deletion requested'
WHERE published_at IS NULL AND EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.deletion_state != 'ACTIVE' AND (
    (CASE WHEN json_valid(queue_outbox.payload_json)
      THEN json_extract(queue_outbox.payload_json, '$.workspaceId') END = w.id)
    OR (CASE WHEN json_valid(queue_outbox.payload_json)
      THEN json_extract(queue_outbox.payload_json, '$.runId') END IN (
        SELECT r.id FROM test_runs r WHERE r.workspace_id = w.id
      ))
    OR (CASE WHEN json_valid(queue_outbox.payload_json)
      THEN json_extract(queue_outbox.payload_json, '$.monitorId') END IN (
        SELECT m.id FROM uptime_monitors m WHERE m.workspace_id = w.id
      ))
    OR (CASE WHEN json_valid(queue_outbox.payload_json)
      THEN json_extract(queue_outbox.payload_json, '$.deliveryId') END IN (
        SELECT d.id FROM notification_deliveries d WHERE d.workspace_id = w.id
      ))
  )
);

UPDATE durable_jobs
SET quarantined_at = COALESCE(quarantined_at, updated_at),
    last_error = 'workspace deletion requested'
WHERE status = 'PENDING' AND EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.deletion_state != 'ACTIVE' AND (
    (CASE WHEN json_valid(durable_jobs.payload_json)
      THEN json_extract(durable_jobs.payload_json, '$.workspaceId') END = w.id)
    OR (CASE WHEN json_valid(durable_jobs.payload_json)
      THEN json_extract(durable_jobs.payload_json, '$.runId') END IN (
        SELECT r.id FROM test_runs r WHERE r.workspace_id = w.id
      ))
    OR (CASE WHEN json_valid(durable_jobs.payload_json)
      THEN json_extract(durable_jobs.payload_json, '$.monitorId') END IN (
        SELECT m.id FROM uptime_monitors m WHERE m.workspace_id = w.id
      ))
    OR (CASE WHEN json_valid(durable_jobs.payload_json)
      THEN json_extract(durable_jobs.payload_json, '$.deliveryId') END IN (
        SELECT d.id FROM notification_deliveries d WHERE d.workspace_id = w.id
      ))
  )
);

UPDATE incidents
SET status = 'RESOLVED',
    resolved_at = COALESCE(resolved_at, (
      SELECT w.deletion_requested_at FROM workspaces w
      WHERE w.id = incidents.workspace_id
    ))
WHERE status = 'OPEN' AND workspace_id IN (
  SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
);

DELETE FROM pending_overage_periods WHERE workspace_id IN (
  SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
);
DELETE FROM paddle_checkout_intents WHERE workspace_id IN (
  SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
);

UPDATE workspace_alert_settings
SET paid_channels_enabled = 0,
    updated_at = COALESCE(
      (SELECT w.deletion_requested_at FROM workspaces w
       WHERE w.id = workspace_alert_settings.workspace_id),
      updated_at
    )
WHERE workspace_id IN (
  SELECT id FROM workspaces WHERE deletion_state != 'ACTIVE'
);

-- Database fencing: even a stale isolate or a delayed queue delivery cannot
-- create/restore provider work after the tombstone is committed.
CREATE TRIGGER prevent_delivery_after_workspace_tombstone_insert
BEFORE INSERT ON notification_deliveries
WHEN NEW.status = 'PENDING' AND EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.id = NEW.workspace_id
    AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE')
)
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE');
END;

CREATE TRIGGER prevent_delivery_after_workspace_tombstone_update
BEFORE UPDATE OF status ON notification_deliveries
WHEN NEW.status = 'PENDING' AND EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.id = NEW.workspace_id
    AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE')
)
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE');
END;

CREATE TRIGGER prevent_channel_enable_after_workspace_tombstone
BEFORE UPDATE OF enabled ON notification_channels
WHEN NEW.enabled = 1 AND EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.id = NEW.workspace_id
    AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE')
)
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE');
END;

CREATE TRIGGER prevent_active_run_after_workspace_tombstone_insert
BEFORE INSERT ON test_runs
WHEN NEW.status IN ('QUEUED', 'RUNNING') AND EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.id = NEW.workspace_id
    AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE')
)
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE');
END;

CREATE TRIGGER prevent_active_run_after_workspace_tombstone_update
BEFORE UPDATE OF status ON test_runs
WHEN NEW.status IN ('QUEUED', 'RUNNING') AND EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.id = NEW.workspace_id
    AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE')
)
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE');
END;

-- Fence every remaining customer-data producer. The EXISTS form intentionally
-- targets known tombstones without changing legacy orphan-tolerant test/data
-- semantics for rows whose workspace never existed.
CREATE TRIGGER prevent_member_after_workspace_tombstone
BEFORE INSERT ON workspace_members
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_invitation_after_workspace_tombstone
BEFORE INSERT ON workspace_invitations
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_secret_after_workspace_tombstone
BEFORE INSERT ON workspace_secrets
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_channel_after_workspace_tombstone
BEFORE INSERT ON notification_channels
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_browser_test_after_workspace_tombstone
BEFORE INSERT ON browser_tests
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_artifact_after_workspace_tombstone
BEFORE INSERT ON run_artifacts
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_incident_after_workspace_tombstone
BEFORE INSERT ON incidents
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_monitor_after_workspace_tombstone
BEFORE INSERT ON uptime_monitors
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_check_after_workspace_tombstone
BEFORE INSERT ON uptime_checks
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_overage_work_after_workspace_tombstone
BEFORE INSERT ON pending_overage_periods
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_api_key_after_workspace_tombstone
BEFORE INSERT ON workspace_api_keys
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_alert_settings_after_workspace_tombstone
BEFORE INSERT ON workspace_alert_settings
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_alert_balance_after_workspace_tombstone
BEFORE INSERT ON alert_credit_balances
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

CREATE TRIGGER prevent_checkout_intent_after_workspace_tombstone
BEFORE INSERT ON paddle_checkout_intents
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

-- Billing/security evidence may legitimately arrive after cancellation (for
-- example a delayed provider webhook). Retain it, but automatically scrub
-- customer-facing identifiers and free text against the durable tombstone.
CREATE TRIGGER anonymize_subscription_after_tombstone_insert
AFTER INSERT ON subscriptions
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN
  UPDATE workspaces
  SET deletion_state = 'CANCELLATION_PENDING', deletion_retry_at = 0,
      deletion_attempt_count = 0, deletion_last_error = NULL,
      deletion_processing_at = NULL, deletion_completed_at = NULL
  WHERE id = NEW.workspace_id
    AND deletion_state IN ('PURGE_PENDING','COMPLETED')
    AND NEW.status != 'CANCELED';
  UPDATE subscriptions SET provider_customer_id = NULL,
    cancel_at_period_end = 0, update_payment_url = NULL, cancel_url = NULL
  WHERE id = NEW.id;
END;

CREATE TRIGGER anonymize_subscription_after_tombstone_update
AFTER UPDATE ON subscriptions
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
    AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE')
    AND (NEW.provider_customer_id IS NOT NULL
      OR NEW.update_payment_url IS NOT NULL OR NEW.cancel_url IS NOT NULL
      OR (w.deletion_state IN ('PURGE_PENDING','COMPLETED')
        AND NEW.status != 'CANCELED')))
BEGIN
  UPDATE workspaces
  SET deletion_state = 'CANCELLATION_PENDING', deletion_retry_at = 0,
      deletion_attempt_count = 0, deletion_last_error = NULL,
      deletion_processing_at = NULL, deletion_completed_at = NULL
  WHERE id = NEW.workspace_id
    AND deletion_state IN ('PURGE_PENDING','COMPLETED')
    AND NEW.status != 'CANCELED';
  UPDATE subscriptions SET provider_customer_id = NULL,
    cancel_at_period_end = 0, update_payment_url = NULL, cancel_url = NULL
  WHERE id = NEW.id;
END;

CREATE TRIGGER anonymize_usage_after_tombstone_insert
AFTER INSERT ON usage_events
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN
  UPDATE usage_events SET test_run_id = 'deleted:' || id,
    idempotency_key = 'retained:' || id, billable = 0,
    reversed_at = COALESCE(reversed_at,
      (SELECT deletion_requested_at FROM workspaces WHERE id = NEW.workspace_id))
  WHERE id = NEW.id;
END;

CREATE TRIGGER anonymize_alert_ledger_after_tombstone_insert
AFTER INSERT ON alert_credit_entries
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN
  UPDATE alert_credit_entries SET delivery_id = NULL,
    description = 'Retained financial ledger entry',
    idempotency_key = 'retained:' || id
  WHERE id = NEW.id;
END;

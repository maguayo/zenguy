-- Strict distributed abuse controls live in D1 so concurrent isolates cannot
-- overrun an eventually-consistent KV counter.
CREATE TABLE rate_limit_windows (
  rate_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 1),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (rate_key, window_start)
);
CREATE INDEX idx_rate_limit_expiry ON rate_limit_windows(expires_at);

-- Multiple workspaces remain supported, but one identity cannot mint an
-- unbounded number of free tenants. Existing owners above the cap are
-- grandfathered; the trigger only blocks new inserts.
CREATE TRIGGER enforce_owned_workspace_cap
BEFORE INSERT ON workspaces
WHEN NEW.deleted_at IS NULL AND (
  SELECT COUNT(*)
  FROM workspaces
  WHERE owner_user_id = NEW.owner_user_id AND deleted_at IS NULL
) >= 3
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_OWNED_WORKSPACE_CAP');
END;

-- Complimentary accounts cannot multiply their allowance by creating more
-- workspaces. Reserving a unit at run insertion makes the 300-run owner cap
-- atomic with the run/outbox transaction; changing a SYSTEM_ERROR run to
-- billable=0 releases the unit.
CREATE TRIGGER enforce_complimentary_run_cap
BEFORE INSERT ON test_runs
WHEN NEW.billable = 1 AND EXISTS (
  SELECT 1
  FROM subscriptions AS s
  WHERE s.workspace_id = NEW.workspace_id
    AND (s.source IN ('free', 'grant') OR s.provider_subscription_id IS NULL)
    AND (
      SELECT COUNT(*)
      FROM test_runs AS existing
      JOIN workspaces AS existing_workspace
        ON existing_workspace.id = existing.workspace_id
      JOIN subscriptions AS existing_subscription
        ON existing_subscription.workspace_id = existing.workspace_id
      WHERE existing_workspace.owner_user_id = (
          SELECT owner_user_id FROM workspaces WHERE id = NEW.workspace_id
        )
        AND existing_workspace.deleted_at IS NULL
        AND (
          existing_subscription.source IN ('free', 'grant')
          OR existing_subscription.provider_subscription_id IS NULL
        )
        AND existing.billable = 1
        AND existing.created_at >= COALESCE(
          s.period_start,
          CAST(strftime('%s', NEW.created_at / 1000, 'unixepoch', 'start of month') AS INTEGER) * 1000
        )
        AND existing.created_at < COALESCE(
          s.period_end,
          CAST(strftime('%s', NEW.created_at / 1000, 'unixepoch', 'start of month', '+1 month') AS INTEGER) * 1000
        )
    ) >= 300
)
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_COMPLIMENTARY_RUN_CAP');
END;

-- Bound active cost even when many tests or workspaces are scheduled at once.
-- These guards are atomic across Worker isolates because they execute inside
-- the same D1 transaction as the run/outbox insert.
CREATE TRIGGER enforce_workspace_active_run_cap
BEFORE INSERT ON test_runs
WHEN NEW.status IN ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_RETRY') AND (
  SELECT COUNT(*) FROM test_runs
  WHERE workspace_id = NEW.workspace_id
    AND status IN ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_RETRY')
) >= 10
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_ACTIVE_RUN_CAP');
END;

CREATE TRIGGER enforce_owner_active_run_cap
BEFORE INSERT ON test_runs
WHEN NEW.status IN ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_RETRY') AND (
  SELECT COUNT(*)
  FROM test_runs AS active_run
  JOIN workspaces AS active_workspace
    ON active_workspace.id = active_run.workspace_id
  WHERE active_workspace.owner_user_id = (
      SELECT owner_user_id FROM workspaces WHERE id = NEW.workspace_id
    )
    AND active_workspace.deleted_at IS NULL
    AND active_run.status IN ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_RETRY')
) >= 20
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_OWNER_ACTIVE_RUN_CAP');
END;

CREATE TRIGGER enforce_browser_test_cap
BEFORE INSERT ON browser_tests
WHEN NEW.deleted_at IS NULL AND (
  SELECT COUNT(*) FROM browser_tests
  WHERE workspace_id = NEW.workspace_id AND deleted_at IS NULL
) >= 200
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_COLLECTION_CAP_BROWSER_TESTS');
END;

CREATE TRIGGER enforce_uptime_monitor_cap
BEFORE INSERT ON uptime_monitors
WHEN NEW.deleted_at IS NULL AND (
  SELECT COUNT(*) FROM uptime_monitors
  WHERE workspace_id = NEW.workspace_id AND deleted_at IS NULL
) >= 200
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_COLLECTION_CAP_UPTIME_MONITORS');
END;

CREATE TRIGGER enforce_secret_cap
BEFORE INSERT ON workspace_secrets
WHEN (
  SELECT COUNT(*) FROM workspace_secrets
  WHERE workspace_id = NEW.workspace_id
) >= 100
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_COLLECTION_CAP_SECRETS');
END;

CREATE TRIGGER enforce_channel_cap
BEFORE INSERT ON notification_channels
WHEN (
  SELECT COUNT(*) FROM notification_channels
  WHERE workspace_id = NEW.workspace_id
) >= 50
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_COLLECTION_CAP_CHANNELS');
END;

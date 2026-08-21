-- Alerts: default email channel, pay-as-you-go phone channels (SMS, calls,
-- WhatsApp) charged from a prepaid per-workspace credit, and per-delivery cost.

ALTER TABLE notification_channels ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN cost_cents INTEGER;
ALTER TABLE notification_deliveries ADD COLUMN destination_country TEXT;

CREATE TABLE workspace_alert_settings (
  workspace_id TEXT PRIMARY KEY,
  paid_channels_enabled INTEGER NOT NULL DEFAULT 0,
  daily_paid_alert_limit INTEGER NOT NULL DEFAULT 20,
  -- Set once the workspace received its default email channel, so a channel
  -- the team later deletes is never recreated.
  default_email_channel_created_at INTEGER,
  -- When the last low-balance / exhausted notice went out. Cleared on top-up.
  low_balance_notified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE alert_credit_balances (
  workspace_id TEXT PRIMARY KEY,
  balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  -- Token written by the balance UPDATE so the ledger INSERT in the same
  -- batch can be made conditional on that UPDATE having applied.
  last_entry_token TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE alert_credit_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('TOPUP','GRANT','CHARGE','REFUND','ADJUSTMENT')),
  -- Signed: charges are negative, everything else positive.
  amount_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  delivery_id TEXT,
  provider_transaction_id TEXT,
  description TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_alert_credit_entries_idempotency
  ON alert_credit_entries(idempotency_key);
CREATE INDEX idx_alert_credit_entries_ws_time
  ON alert_credit_entries(workspace_id, created_at DESC, id DESC);
CREATE INDEX idx_alert_credit_entries_ws_kind_time
  ON alert_credit_entries(workspace_id, kind, created_at);
CREATE INDEX idx_alert_credit_entries_delivery
  ON alert_credit_entries(delivery_id) WHERE delivery_id IS NOT NULL;

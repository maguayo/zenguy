CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'paddle',
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('NONE','ACTIVE','PAST_DUE','CANCELED')),
  period_start INTEGER,
  period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  update_payment_url TEXT,
  cancel_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_subscriptions_ws ON subscriptions(workspace_id);
CREATE UNIQUE INDEX idx_subscriptions_provider ON subscriptions(provider_subscription_id);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  test_run_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'BROWSER_RUN',
  quantity INTEGER NOT NULL DEFAULT 1,
  billable INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  reversed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_usage_idempotency ON usage_events(idempotency_key);
CREATE UNIQUE INDEX idx_usage_run ON usage_events(test_run_id);
CREATE INDEX idx_usage_ws_time ON usage_events(workspace_id, occurred_at);

CREATE TABLE overage_reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  overage_runs INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  paddle_transaction_id TEXT,
  reported_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_overage_ws_period ON overage_reports(workspace_id, period_start);

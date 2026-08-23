-- Server-issued, one-use authority for associating Paddle checkouts with a
-- workspace. Browser-controlled custom_data now carries only this opaque ID
-- and an HMAC; the expected price, quantity and owner stay in D1.
CREATE TABLE paddle_checkout_intents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('subscription','alert_credit')),
  price_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  currency_code TEXT NOT NULL CHECK (currency_code = 'EUR'),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  provider_reference TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_paddle_checkout_intents_expiry
  ON paddle_checkout_intents (expires_at);
CREATE UNIQUE INDEX idx_paddle_checkout_intents_provider_reference
  ON paddle_checkout_intents (provider_reference)
  WHERE provider_reference IS NOT NULL;

-- Provider IDs must never be rebound to a second tenant.
CREATE UNIQUE INDEX idx_subscriptions_provider_subscription_unique
  ON subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX idx_alert_credit_entries_provider_transaction
  ON alert_credit_entries (provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

-- Refunds and chargebacks may create debt. A non-positive balance blocks
-- further paid sends until the owner tops up again.
CREATE TABLE alert_credit_balances_v2 (
  workspace_id TEXT PRIMARY KEY,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  last_entry_token TEXT,
  updated_at INTEGER NOT NULL
);
INSERT INTO alert_credit_balances_v2
  (workspace_id, balance_cents, last_entry_token, updated_at)
SELECT workspace_id, balance_cents, last_entry_token, updated_at
FROM alert_credit_balances;
DROP TABLE alert_credit_balances;
ALTER TABLE alert_credit_balances_v2 RENAME TO alert_credit_balances;

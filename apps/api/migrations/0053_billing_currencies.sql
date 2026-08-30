-- Persist the currency selected for every Stripe subscription and pin it to
-- rollover/overage records so later requests cannot change an existing bill.
ALTER TABLE subscriptions
  ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'EUR'
  CHECK (currency_code IN ('EUR', 'USD'));

ALTER TABLE pending_overage_periods
  ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'EUR'
  CHECK (currency_code IN ('EUR', 'USD'));

ALTER TABLE overage_reports
  ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'EUR'
  CHECK (currency_code IN ('EUR', 'USD'));

-- SQLite cannot widen the existing EUR-only CHECK constraint in place.
ALTER TABLE stripe_checkout_intents
  RENAME TO stripe_checkout_intents_legacy;

CREATE TABLE stripe_checkout_intents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('subscription','alert_credit')),
  product_id TEXT NOT NULL CHECK (length(trim(product_id)) > 0),
  price_id TEXT NOT NULL CHECK (length(trim(price_id)) > 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  currency_code TEXT NOT NULL CHECK (currency_code IN ('EUR', 'USD')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  provider_reference TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO stripe_checkout_intents (
  id, workspace_id, actor_user_id, purpose, product_id, price_id, quantity,
  currency_code, amount_cents, created_at, expires_at, consumed_at,
  provider_reference
)
SELECT
  id, workspace_id, actor_user_id, purpose, product_id, price_id, quantity,
  currency_code, amount_cents, created_at, expires_at, consumed_at,
  provider_reference
FROM stripe_checkout_intents_legacy;

DROP TABLE stripe_checkout_intents_legacy;

CREATE INDEX idx_stripe_checkout_intents_expiry
  ON stripe_checkout_intents (expires_at);
CREATE UNIQUE INDEX idx_stripe_checkout_intents_provider_reference
  ON stripe_checkout_intents (provider_reference)
  WHERE provider_reference IS NOT NULL;

-- Stripe Checkout Sessions are issued server-side and bound to one workspace,
-- owner and immutable catalog selection. The signed webhook consumes each
-- intent once; provider_reference prevents one Session being rebound.
CREATE TABLE stripe_checkout_intents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('subscription','alert_credit')),
  product_id TEXT NOT NULL CHECK (length(trim(product_id)) > 0),
  price_id TEXT NOT NULL CHECK (length(trim(price_id)) > 0),
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

CREATE INDEX idx_stripe_checkout_intents_expiry
  ON stripe_checkout_intents (expires_at);
CREATE UNIQUE INDEX idx_stripe_checkout_intents_provider_reference
  ON stripe_checkout_intents (provider_reference)
  WHERE provider_reference IS NOT NULL;

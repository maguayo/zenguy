ALTER TABLE subscriptions ADD COLUMN source TEXT NOT NULL DEFAULT 'paddle';

CREATE TABLE subscription_grants (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  issued_by_user_id TEXT NOT NULL,
  note TEXT,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_workspace_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_subscription_grants_hash
  ON subscription_grants(token_hash);
CREATE INDEX idx_subscription_grants_issuer
  ON subscription_grants(issued_by_user_id, created_at DESC);

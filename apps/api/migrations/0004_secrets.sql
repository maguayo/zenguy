CREATE TABLE workspace_secrets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  encryption_version INTEGER NOT NULL DEFAULT 1,
  allowed_domains TEXT NOT NULL,
  description TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_secrets_ws_key ON workspace_secrets(workspace_id, key);

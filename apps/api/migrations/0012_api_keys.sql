CREATE TABLE workspace_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX idx_api_keys_hash ON workspace_api_keys(key_hash);
CREATE INDEX idx_api_keys_ws ON workspace_api_keys(workspace_id);

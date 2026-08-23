-- API keys are explicitly least-privileged and finite-lived. Existing keys
-- receive the read-only V1 surface and at least 30 days to rotate.
ALTER TABLE workspace_api_keys RENAME TO workspace_api_keys_legacy;

CREATE TABLE workspace_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

INSERT INTO workspace_api_keys (
  id, workspace_id, name, key_prefix, key_hash, scopes_json, expires_at,
  created_by, created_at, last_used_at, revoked_at
)
SELECT
  id,
  workspace_id,
  name,
  key_prefix,
  key_hash,
  '["workspace:read","uptime:read","tests:read","runs:read"]',
  MAX(created_at + 7776000000, unixepoch('now') * 1000 + 2592000000),
  created_by,
  created_at,
  last_used_at,
  revoked_at
FROM workspace_api_keys_legacy;

DROP TABLE workspace_api_keys_legacy;

CREATE UNIQUE INDEX idx_api_keys_hash ON workspace_api_keys(key_hash);
CREATE INDEX idx_api_keys_ws ON workspace_api_keys(workspace_id);
CREATE INDEX idx_api_keys_active_expiry
  ON workspace_api_keys(workspace_id, revoked_at, expires_at);

-- Recreate the workspace-deletion tombstone trigger dropped with the legacy
-- table during the constrained SQLite table rebuild.
CREATE TRIGGER prevent_api_key_after_workspace_tombstone
BEFORE INSERT ON workspace_api_keys
WHEN EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id
  AND (w.deleted_at IS NOT NULL OR w.deletion_state != 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_DELETION_TOMBSTONE'); END;

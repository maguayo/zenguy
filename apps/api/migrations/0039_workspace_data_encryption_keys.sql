-- Random tenant DEKs. The Worker stores only authenticated wrapped key
-- material; plaintext DEKs exist only transiently in Worker memory and are
-- imported as non-extractable Web Crypto keys for data operations.
CREATE TABLE workspace_data_encryption_keys (
  workspace_id TEXT NOT NULL,
  data_key_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  wrapping_key_id TEXT NOT NULL CHECK (
    length(wrapping_key_id) BETWEEN 1 AND 64
  ),
  wrap_version INTEGER NOT NULL CHECK (wrap_version = 1),
  wrapped_key TEXT NOT NULL CHECK (
    length(wrapped_key) BETWEEN 64 AND 512
  ),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  retired_at INTEGER,
  PRIMARY KEY (workspace_id, data_key_id),
  UNIQUE (workspace_id, generation),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CHECK (
    (active = 1 AND retired_at IS NULL) OR
    (active = 0 AND retired_at IS NOT NULL AND retired_at >= created_at)
  )
);

CREATE UNIQUE INDEX idx_workspace_data_encryption_keys_active
  ON workspace_data_encryption_keys(workspace_id)
  WHERE active = 1;

CREATE INDEX idx_workspace_data_encryption_keys_wrapping_key
  ON workspace_data_encryption_keys(wrapping_key_id, active);

-- Identity/generation changes would break ciphertext lookup or allow a key to
-- cross a tenant boundary. Rotation inserts a new generation instead.
CREATE TRIGGER trg_workspace_data_encryption_keys_identity_immutable
BEFORE UPDATE OF workspace_id, data_key_id, generation, created_at
ON workspace_data_encryption_keys
BEGIN
  SELECT RAISE(ABORT, 'workspace data key identity is immutable');
END;

-- A late queue/request must not recreate or re-wrap key material after the
-- deletion tombstone has quiesced a workspace.
CREATE TRIGGER trg_workspace_data_encryption_keys_insert_operational
BEFORE INSERT ON workspace_data_encryption_keys
WHEN NOT EXISTS (
  SELECT 1 FROM workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL
    AND deletion_state = 'ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_NOT_OPERATIONAL');
END;

CREATE TRIGGER trg_workspace_data_encryption_keys_update_operational
BEFORE UPDATE ON workspace_data_encryption_keys
WHEN NOT EXISTS (
  SELECT 1 FROM workspaces
  WHERE id = NEW.workspace_id
    AND deleted_at IS NULL
    AND deletion_state = 'ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_WORKSPACE_NOT_OPERATIONAL');
END;

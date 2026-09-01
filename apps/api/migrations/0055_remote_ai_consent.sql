-- Remote model processing is optional and disabled by default. One row keeps
-- the current, auditable workspace decision; a policy-version bump requires a
-- fresh affirmative acceptance.
CREATE TABLE workspace_remote_ai_consents (
  workspace_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('openai')),
  policy_version TEXT NOT NULL,
  accepted_by_user_id TEXT,
  accepted_at INTEGER NOT NULL,
  revoked_by_user_id TEXT,
  revoked_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK (revoked_at IS NOT NULL OR revoked_by_user_id IS NULL)
);

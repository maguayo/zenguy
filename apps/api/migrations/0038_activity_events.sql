-- Internal activity events (visits, auth, mutations, executions, incidents, alerts).
-- Append-only; purged by the daily retention job; deleted with their workspace.
CREATE TABLE activity_events (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  user_id         TEXT,
  workspace_id    TEXT,
  source          TEXT NOT NULL CHECK (source IN ('web','app','api','server')),
  resource_type   TEXT,
  resource_id     TEXT,
  properties_json TEXT,
  occurred_at     INTEGER NOT NULL
);
CREATE INDEX idx_activity_ws_time      ON activity_events (workspace_id, occurred_at DESC);
CREATE INDEX idx_activity_ws_type_time ON activity_events (workspace_id, type, occurred_at DESC);
CREATE INDEX idx_activity_user_time    ON activity_events (user_id, occurred_at DESC);
CREATE INDEX idx_activity_time         ON activity_events (occurred_at DESC);
-- "Last login of a user" (admin users/workspaces): a seek instead of reading every event of the user.
CREATE INDEX idx_activity_user_type_time ON activity_events (user_id, type, occurred_at DESC);
-- Admin feed filtered by type: a seek instead of a newest-first scan of the whole table.
CREATE INDEX idx_activity_type_time    ON activity_events (type, occurred_at DESC);
-- "Last web / last app visit" of a workspace: a seek even when it has no rows of that source.
CREATE INDEX idx_activity_ws_source_time ON activity_events (workspace_id, source, occurred_at DESC);

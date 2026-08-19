CREATE TABLE uptime_monitors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('GET','POST','PUT','PATCH','DELETE','HEAD')),
  encrypted_headers TEXT,
  encrypted_body TEXT,
  expected_status INTEGER NOT NULL DEFAULT 200,
  body_condition TEXT CHECK (body_condition IN ('CONTAINS','NOT_CONTAINS','EQUALS','JSON_PATH_EQUALS')),
  body_expected_value TEXT,
  body_condition_path TEXT,
  frequency_seconds INTEGER NOT NULL,
  timeout_seconds INTEGER NOT NULL DEFAULT 10 CHECK (timeout_seconds BETWEEN 1 AND 30),
  max_retries INTEGER NOT NULL DEFAULT 0 CHECK (max_retries BETWEEN 0 AND 3),
  notify_on_recovery INTEGER NOT NULL DEFAULT 1,
  next_check_at INTEGER NOT NULL,
  current_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (current_status IN ('UNKNOWN','UP','DOWN')),
  current_cycle_id TEXT,
  cycle_started_at INTEGER,
  last_check_at INTEGER,
  last_response_time_ms INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_monitors_ws ON uptime_monitors(workspace_id);
CREATE INDEX idx_monitors_due ON uptime_monitors(next_check_at)
  WHERE deleted_at IS NULL;

CREATE TABLE uptime_monitor_channels (
  uptime_monitor_id TEXT NOT NULL,
  notification_channel_id TEXT NOT NULL,
  PRIMARY KEY (uptime_monitor_id, notification_channel_id)
);

CREATE TABLE uptime_checks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  uptime_monitor_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  attempt_index INTEGER NOT NULL CHECK (attempt_index BETWEEN 0 AND 3),
  status TEXT NOT NULL CHECK (status IN ('PASSED','FAILED')),
  http_status INTEGER,
  response_time_ms INTEGER,
  failure_reason TEXT,
  response_excerpt TEXT,
  checked_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_checks_cycle_attempt
  ON uptime_checks(cycle_id, attempt_index);
CREATE INDEX idx_checks_monitor_time
  ON uptime_checks(uptime_monitor_id, checked_at DESC);

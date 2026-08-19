CREATE TABLE browser_tests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_url TEXT NOT NULL,
  instructions TEXT NOT NULL,
  device TEXT NOT NULL CHECK (device IN ('DESKTOP','MOBILE')),
  interval_hours INTEGER NOT NULL CHECK (interval_hours BETWEEN 1 AND 24),
  max_retries INTEGER NOT NULL CHECK (max_retries BETWEEN 0 AND 3),
  notify_on_recovery INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_bt_ws ON browser_tests(workspace_id);
CREATE INDEX idx_bt_due ON browser_tests(next_run_at) WHERE deleted_at IS NULL;

CREATE TABLE browser_test_channels (
  browser_test_id TEXT NOT NULL,
  notification_channel_id TEXT NOT NULL,
  PRIMARY KEY (browser_test_id, notification_channel_id)
);

CREATE TABLE test_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  browser_test_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('VALIDATION','MANUAL','SCHEDULED')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','PASSED','FAILED','TIMEOUT','SYSTEM_ERROR')),
  snapshot_json TEXT NOT NULL,
  scheduled_for INTEGER,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  duration_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  infra_attempts INTEGER NOT NULL DEFAULT 0,
  passed_after_retry INTEGER NOT NULL DEFAULT 0,
  billable INTEGER NOT NULL DEFAULT 1,
  usage_event_id TEXT,
  triggered_by_user_id TEXT,
  incident_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_runs_ws_time ON test_runs(workspace_id, created_at DESC);
CREATE INDEX idx_runs_test_time ON test_runs(browser_test_id, created_at DESC);
CREATE UNIQUE INDEX idx_runs_active_per_test ON test_runs(browser_test_id)
  WHERE status IN ('QUEUED','RUNNING') AND browser_test_id IS NOT NULL;
CREATE UNIQUE INDEX idx_runs_occurrence ON test_runs(browser_test_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;

CREATE TABLE test_attempts (
  id TEXT PRIMARY KEY,
  test_run_id TEXT NOT NULL,
  attempt_index INTEGER NOT NULL CHECK (attempt_index BETWEEN 0 AND 3),
  status TEXT NOT NULL CHECK (status IN ('QUEUED','STARTING','RUNNING','PASSED','FAILED','TIMEOUT','SYSTEM_ERROR')),
  retry_delay_seconds INTEGER NOT NULL DEFAULT 0,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  duration_ms INTEGER,
  summary TEXT,
  expected_result TEXT,
  actual_result TEXT,
  failure_reason TEXT,
  visited_urls_json TEXT,
  console_errors_json TEXT,
  network_errors_json TEXT,
  token_usage INTEGER,
  model_name TEXT,
  runner_version TEXT,
  system_error_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_attempts_run_index ON test_attempts(test_run_id, attempt_index);

CREATE TABLE run_steps (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  url_sanitized TEXT,
  result TEXT NOT NULL CHECK (result IN ('OK','ERROR')),
  artifact_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_steps_attempt_seq ON run_steps(attempt_id, sequence);

CREATE TABLE run_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  attempt_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('SCREENSHOT','MARKDOWN_REPORT')),
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_artifacts_key ON run_artifacts(storage_key);
CREATE INDEX idx_artifacts_run ON run_artifacts(run_id);
CREATE INDEX idx_artifacts_expiry ON run_artifacts(expires_at);

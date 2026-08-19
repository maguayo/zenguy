CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('BROWSER_TEST','UPTIME_MONITOR')),
  browser_test_id TEXT,
  uptime_monitor_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN','RESOLVED')),
  opened_at INTEGER NOT NULL,
  resolved_at INTEGER,
  opened_by_run_id TEXT,
  resolved_by_run_id TEXT,
  opened_by_check_id TEXT,
  resolved_by_check_id TEXT,
  last_event_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_incidents_open_test ON incidents(browser_test_id)
  WHERE status = 'OPEN' AND browser_test_id IS NOT NULL;
CREATE UNIQUE INDEX idx_incidents_open_monitor ON incidents(uptime_monitor_id)
  WHERE status = 'OPEN' AND uptime_monitor_id IS NOT NULL;
CREATE INDEX idx_incidents_ws_time ON incidents(workspace_id, opened_at DESC);

CREATE TABLE incident_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('OPENED','FAILURE_RECORDED','NOTIFICATION_SENT','NOTIFICATION_FAILED','RESOLVED','TEST_DELETED','MONITOR_DELETED')),
  source_id TEXT,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_incident_events_incident ON incident_events(incident_id, created_at);

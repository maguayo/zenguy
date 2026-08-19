CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('EMAIL','SMS','WHATSAPP','CALL','SLACK','DISCORD')),
  encrypted_config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  verified_at INTEGER,
  last_delivery_status TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_channels_ws ON notification_channels(workspace_id);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  incident_id TEXT,
  notification_channel_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('FAILURE','RECOVERY','TEST')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','SENT','FAILED')),
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_sanitized TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_deliveries_channel_time ON notification_deliveries(notification_channel_id, created_at DESC);
CREATE INDEX idx_deliveries_incident ON notification_deliveries(incident_id);

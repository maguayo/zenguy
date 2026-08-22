-- Mobile push notifications: one row per registered device (Expo push token)
-- and a free PUSH channel type that reaches every workspace member's devices.

CREATE TABLE user_push_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  device_name TEXT,
  app_version TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  disabled_reason TEXT,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_push_devices_token ON user_push_devices(token);
CREATE INDEX idx_push_devices_user ON user_push_devices(user_id);

ALTER TABLE workspace_alert_settings ADD COLUMN default_push_channel_created_at INTEGER;

-- SQLite cannot widen a CHECK constraint in place: rebuild notification_channels
-- with 'PUSH' allowed, preserving rows, column order, and the index.
CREATE TABLE notification_channels_v2 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('EMAIL','SMS','WHATSAPP','CALL','SLACK','DISCORD','PUSH')),
  encrypted_config TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  verified_at INTEGER,
  last_delivery_status TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);
INSERT INTO notification_channels_v2
  (id, workspace_id, name, type, encrypted_config, enabled, verified_at,
   last_delivery_status, created_by, created_at, updated_at, is_default)
SELECT id, workspace_id, name, type, encrypted_config, enabled, verified_at,
       last_delivery_status, created_by, created_at, updated_at, is_default
FROM notification_channels;
DROP TABLE notification_channels;
ALTER TABLE notification_channels_v2 RENAME TO notification_channels;
CREATE INDEX idx_channels_ws ON notification_channels(workspace_id);

-- Mobile push is a workspace default, regardless of whether a device has
-- registered yet. Repair legacy/manual PUSH channels that predate that rule
-- and attach them to every active test and uptime monitor.

UPDATE notification_channels
SET is_default = 1
WHERE type = 'PUSH';

INSERT OR IGNORE INTO browser_test_channels
  (browser_test_id, notification_channel_id)
SELECT t.id, c.id
FROM browser_tests t
JOIN notification_channels c
  ON c.workspace_id = t.workspace_id AND c.type = 'PUSH'
WHERE t.deleted_at IS NULL;

INSERT OR IGNORE INTO uptime_monitor_channels
  (uptime_monitor_id, notification_channel_id)
SELECT m.id, c.id
FROM uptime_monitors m
JOIN notification_channels c
  ON c.workspace_id = m.workspace_id AND c.type = 'PUSH'
WHERE m.deleted_at IS NULL;

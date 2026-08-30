-- Daily Cloudflare platform usage collected by the admin panel's cron
-- (apps/admin). These two tables are owned by the admin Worker, like
-- admin_sessions: the product API never reads or writes them.
CREATE TABLE platform_usage_daily (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  collected_at INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
);

CREATE INDEX idx_platform_usage_daily_metric_day
  ON platform_usage_daily (metric, day DESC);

CREATE TABLE platform_usage_collections (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('cron', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('OK', 'PARTIAL', 'FAILED')),
  from_day TEXT NOT NULL,
  to_day TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  details_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_platform_usage_collections_started
  ON platform_usage_collections (started_at DESC);

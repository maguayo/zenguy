CREATE TABLE status_pages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  accent_color TEXT,
  theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('LIGHT','DARK','SYSTEM')),
  published_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX idx_status_pages_slug ON status_pages(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_status_pages_ws ON status_pages(workspace_id);

CREATE TABLE status_page_items (
  id TEXT PRIMARY KEY,
  status_page_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('BROWSER_TEST','UPTIME_MONITOR')),
  browser_test_id TEXT,
  uptime_monitor_id TEXT,
  display_name TEXT NOT NULL,
  group_name TEXT,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (
    (resource_type = 'BROWSER_TEST' AND browser_test_id IS NOT NULL AND uptime_monitor_id IS NULL)
    OR (resource_type = 'UPTIME_MONITOR' AND uptime_monitor_id IS NOT NULL AND browser_test_id IS NULL)
  )
);
CREATE UNIQUE INDEX idx_spi_page_test ON status_page_items(status_page_id, browser_test_id)
  WHERE browser_test_id IS NOT NULL;
CREATE UNIQUE INDEX idx_spi_page_monitor ON status_page_items(status_page_id, uptime_monitor_id)
  WHERE uptime_monitor_id IS NOT NULL;
CREATE INDEX idx_spi_page ON status_page_items(status_page_id, position);
CREATE INDEX idx_spi_test ON status_page_items(browser_test_id) WHERE browser_test_id IS NOT NULL;
CREATE INDEX idx_spi_monitor ON status_page_items(uptime_monitor_id) WHERE uptime_monitor_id IS NOT NULL;

CREATE TABLE incident_updates (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_incident_updates_incident ON incident_updates(incident_id, created_at DESC);
CREATE INDEX idx_incident_updates_ws ON incident_updates(workspace_id);

CREATE TRIGGER enforce_status_page_cap
BEFORE INSERT ON status_pages
WHEN NEW.deleted_at IS NULL AND (
  SELECT COUNT(*) FROM status_pages
  WHERE workspace_id = NEW.workspace_id AND deleted_at IS NULL
) >= 5
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_COLLECTION_CAP_STATUS_PAGES');
END;

CREATE TRIGGER enforce_status_page_item_cap
BEFORE INSERT ON status_page_items
WHEN (
  SELECT COUNT(*) FROM status_page_items
  WHERE status_page_id = NEW.status_page_id
) >= 50
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_COLLECTION_CAP_STATUS_PAGE_ITEMS');
END;

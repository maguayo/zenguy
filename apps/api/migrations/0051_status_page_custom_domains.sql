ALTER TABLE status_pages ADD COLUMN custom_domain TEXT;
ALTER TABLE status_pages ADD COLUMN custom_hostname_id TEXT;
ALTER TABLE status_pages ADD COLUMN custom_domain_status TEXT
  CHECK (custom_domain_status IN ('PENDING','ACTIVE','FAILED'));
ALTER TABLE status_pages ADD COLUMN custom_domain_checked_at INTEGER;
CREATE UNIQUE INDEX idx_status_pages_custom_domain ON status_pages(custom_domain)
  WHERE custom_domain IS NOT NULL AND deleted_at IS NULL;

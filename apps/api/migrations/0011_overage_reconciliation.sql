ALTER TABLE overage_reports
  ADD COLUMN state TEXT NOT NULL DEFAULT 'COMPLETED'
  CHECK (state IN ('PENDING','AMBIGUOUS','COMPLETED'));
ALTER TABLE overage_reports ADD COLUMN provider_marker TEXT;
ALTER TABLE overage_reports ADD COLUMN attempt_started_at INTEGER;
ALTER TABLE overage_reports ADD COLUMN completed_at INTEGER;

CREATE UNIQUE INDEX idx_overage_provider_marker
  ON overage_reports(provider_marker)
  WHERE provider_marker IS NOT NULL;

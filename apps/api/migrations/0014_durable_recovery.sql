ALTER TABLE queue_outbox ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue_outbox ADD COLUMN quarantined_at INTEGER;
ALTER TABLE queue_outbox ADD COLUMN last_error TEXT;

ALTER TABLE durable_jobs ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE durable_jobs ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE durable_jobs ADD COLUMN quarantined_at INTEGER;
ALTER TABLE durable_jobs ADD COLUMN last_error TEXT;

CREATE INDEX idx_queue_outbox_recovery
  ON queue_outbox(quarantined_at, published_at, available_at, created_at);
CREATE INDEX idx_durable_jobs_recovery
  ON durable_jobs(quarantined_at, status, retry_at, created_at, id);

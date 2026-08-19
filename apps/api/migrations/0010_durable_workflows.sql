CREATE TABLE queue_outbox (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL,
  queue_kind TEXT NOT NULL CHECK (queue_kind IN ('RUN','CHECK','NOTIFY')),
  payload_json TEXT NOT NULL,
  available_at INTEGER NOT NULL,
  publishing_at INTEGER,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_queue_outbox_dedupe ON queue_outbox(dedupe_key);
CREATE INDEX idx_queue_outbox_pending
  ON queue_outbox(published_at, publishing_at, available_at, created_at);

CREATE TABLE durable_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (
    kind IN ('ATTEMPT_CONTINUATION','RUN_FINALIZATION','CHECK_CONTINUATION')
  ),
  aggregate_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','COMPLETED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE UNIQUE INDEX idx_durable_jobs_kind_aggregate
  ON durable_jobs(kind, aggregate_key);
CREATE INDEX idx_durable_jobs_pending
  ON durable_jobs(status, created_at, id);

-- HTTP monitors may use non-idempotent methods. Acquire this durable lease
-- before issuing the request so concurrent Queue redeliveries cannot execute
-- the same cycle/attempt twice. A crashed owner can be fenced and reclaimed
-- after the lease becomes stale.
CREATE TABLE check_execution_claims (
  cycle_id TEXT NOT NULL,
  attempt_index INTEGER NOT NULL,
  claim_token TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (cycle_id, attempt_index)
);
CREATE INDEX idx_check_execution_claims_lease
  ON check_execution_claims(completed_at, claimed_at);

ALTER TABLE notification_deliveries ADD COLUMN dedupe_key TEXT;
ALTER TABLE notification_deliveries ADD COLUMN processing_at INTEGER;
CREATE UNIQUE INDEX idx_deliveries_dedupe
  ON notification_deliveries(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX idx_incident_events_source_once
  ON incident_events(incident_id, type, source_id)
  WHERE source_id IS NOT NULL;

CREATE UNIQUE INDEX idx_artifacts_report_once
  ON run_artifacts(run_id)
  WHERE type = 'MARKDOWN_REPORT';

-- External runner workers (runner/browser_worker.py) report a heartbeat every
-- few seconds so the admin panel can show which executors are online, and
-- every claim records which worker took the attempt.
CREATE TABLE runner_workers (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('local','fallback')),
  version TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

ALTER TABLE test_attempts ADD COLUMN claimed_by_runner_id TEXT;

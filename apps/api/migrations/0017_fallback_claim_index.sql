-- The fallback runner polls for claimable attempts every few seconds; give
-- that scan a covering entry point instead of a full table walk.
CREATE INDEX idx_test_attempts_status_queued_at
  ON test_attempts (status, queued_at);

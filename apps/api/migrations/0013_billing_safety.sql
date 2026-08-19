ALTER TABLE subscriptions ADD COLUMN last_provider_event_at INTEGER;

ALTER TABLE pending_overage_periods ADD COLUMN provider_subscription_id TEXT;
ALTER TABLE pending_overage_periods ADD COLUMN next_attempt_at INTEGER;
ALTER TABLE pending_overage_periods
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

UPDATE pending_overage_periods
SET next_attempt_at = period_end + 3600000
WHERE next_attempt_at IS NULL;

CREATE INDEX idx_pending_overage_ready
  ON pending_overage_periods(next_attempt_at, workspace_id, period_start);

CREATE INDEX idx_subscriptions_period_end
  ON subscriptions(period_end, id)
  WHERE period_end IS NOT NULL;

ALTER TABLE overage_reports ADD COLUMN provider_subscription_id TEXT;

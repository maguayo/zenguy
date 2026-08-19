CREATE TABLE pending_overage_periods (
  workspace_id TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, period_start)
);
CREATE INDEX idx_pending_overage_created
  ON pending_overage_periods(created_at, workspace_id, period_start);

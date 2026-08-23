-- admin.zenguy.com polls recent runs and per-window check/run counts across all
-- workspaces; the existing composite indexes lead with workspace/test/monitor ids
-- and cannot serve a bare time-range scan.
CREATE INDEX idx_test_runs_created_at ON test_runs (created_at DESC);
CREATE INDEX idx_uptime_checks_checked_at ON uptime_checks (checked_at DESC);

-- Hard cost/anomaly ceilings complement the plan allowance and minute-scale
-- request limiter. The single internal policy row can be tuned deliberately
-- by an operator, while every reservation remains atomic in D1.
CREATE TABLE run_cost_limits (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  max_active_runs_per_user INTEGER NOT NULL CHECK (max_active_runs_per_user > 0),
  max_active_runs_global INTEGER NOT NULL CHECK (max_active_runs_global > 0),
  max_daily_runs_per_workspace INTEGER NOT NULL CHECK (max_daily_runs_per_workspace > 0),
  max_daily_runs_per_user INTEGER NOT NULL CHECK (max_daily_runs_per_user > 0),
  max_daily_runs_per_owner INTEGER NOT NULL CHECK (max_daily_runs_per_owner > 0),
  max_daily_runs_global INTEGER NOT NULL CHECK (max_daily_runs_global > 0),
  max_monthly_runs_per_workspace INTEGER NOT NULL CHECK (max_monthly_runs_per_workspace > 0),
  max_monthly_runs_per_user INTEGER NOT NULL CHECK (max_monthly_runs_per_user > 0),
  max_monthly_runs_per_owner INTEGER NOT NULL CHECK (max_monthly_runs_per_owner > 0),
  max_monthly_runs_global INTEGER NOT NULL CHECK (max_monthly_runs_global > 0)
);

INSERT INTO run_cost_limits (
  id,
  max_active_runs_per_user,
  max_active_runs_global,
  max_daily_runs_per_workspace,
  max_daily_runs_per_user,
  max_daily_runs_per_owner,
  max_daily_runs_global,
  max_monthly_runs_per_workspace,
  max_monthly_runs_per_user,
  max_monthly_runs_per_owner,
  max_monthly_runs_global
) VALUES (1, 10, 100, 1000, 1000, 3000, 10000, 10000, 10000, 30000, 100000);

-- Calendar-window counters avoid rescanning the run history for every
-- reservation. A failed later trigger aborts the complete INSERT statement,
-- including increments already made by earlier triggers.
CREATE TABLE run_quota_counters (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('WORKSPACE', 'USER', 'OWNER', 'GLOBAL')),
  scope_id TEXT NOT NULL,
  window_kind TEXT NOT NULL CHECK (window_kind IN ('DAY', 'MONTH')),
  window_start INTEGER NOT NULL,
  run_count INTEGER NOT NULL CHECK (run_count > 0),
  PRIMARY KEY (scope_kind, scope_id, window_kind, window_start)
);
CREATE INDEX idx_run_quota_window_start ON run_quota_counters(window_start);

CREATE INDEX idx_runs_actor_time
  ON test_runs(triggered_by_user_id, created_at);
CREATE INDEX idx_runs_status
  ON test_runs(status);

CREATE TRIGGER enforce_user_active_run_cap
BEFORE INSERT ON test_runs
WHEN NEW.triggered_by_user_id IS NOT NULL
  AND NEW.status IN ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_RETRY')
  AND (
    SELECT COUNT(*)
    FROM test_runs
    WHERE triggered_by_user_id = NEW.triggered_by_user_id
      AND status IN ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_RETRY')
  ) >= (SELECT max_active_runs_per_user FROM run_cost_limits WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_USER_ACTIVE_RUN_CAP');
END;

CREATE TRIGGER enforce_global_active_run_cap
BEFORE INSERT ON test_runs
WHEN NEW.status IN ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_RETRY')
  AND (
    SELECT COUNT(*)
    FROM test_runs
    WHERE status IN ('QUEUED', 'STARTING', 'RUNNING', 'WAITING_RETRY')
  ) >= (SELECT max_active_runs_global FROM run_cost_limits WHERE id = 1)
BEGIN
  SELECT RAISE(ABORT, 'ZENGUY_GLOBAL_ACTIVE_RUN_CAP');
END;

CREATE TRIGGER reserve_workspace_run_quota
BEFORE INSERT ON test_runs
BEGIN
  INSERT INTO run_quota_counters
    (scope_kind, scope_id, window_kind, window_start, run_count)
  VALUES (
    'WORKSPACE', NEW.workspace_id, 'DAY',
    CAST(strftime('%s', NEW.created_at / 1000, 'unixepoch', 'start of day') AS INTEGER) * 1000,
    1
  )
  ON CONFLICT (scope_kind, scope_id, window_kind, window_start)
  DO UPDATE SET run_count = run_count + 1
  WHERE run_count < (
    SELECT max_daily_runs_per_workspace FROM run_cost_limits WHERE id = 1
  );
  -- Wrangler/D1's remote trigger splitter can mistake an unparenthesized
  -- CASE ... END for the end of CREATE TRIGGER. Keep the CASE parenthesized.
  SELECT (CASE WHEN changes() = 0
    THEN RAISE(ABORT, 'ZENGUY_WORKSPACE_DAILY_RUN_CAP') END);

  INSERT INTO run_quota_counters
    (scope_kind, scope_id, window_kind, window_start, run_count)
  VALUES (
    'WORKSPACE', NEW.workspace_id, 'MONTH',
    CAST(strftime('%s', NEW.created_at / 1000, 'unixepoch', 'start of month') AS INTEGER) * 1000,
    1
  )
  ON CONFLICT (scope_kind, scope_id, window_kind, window_start)
  DO UPDATE SET run_count = run_count + 1
  WHERE run_count < (
    SELECT max_monthly_runs_per_workspace FROM run_cost_limits WHERE id = 1
  );
  SELECT (CASE WHEN changes() = 0
    THEN RAISE(ABORT, 'ZENGUY_WORKSPACE_MONTHLY_RUN_CAP') END);
END;

CREATE TRIGGER reserve_user_run_quota
BEFORE INSERT ON test_runs
WHEN NEW.triggered_by_user_id IS NOT NULL
BEGIN
  INSERT INTO run_quota_counters
    (scope_kind, scope_id, window_kind, window_start, run_count)
  VALUES (
    'USER', NEW.triggered_by_user_id, 'DAY',
    CAST(strftime('%s', NEW.created_at / 1000, 'unixepoch', 'start of day') AS INTEGER) * 1000,
    1
  )
  ON CONFLICT (scope_kind, scope_id, window_kind, window_start)
  DO UPDATE SET run_count = run_count + 1
  WHERE run_count < (
    SELECT max_daily_runs_per_user FROM run_cost_limits WHERE id = 1
  );
  SELECT (CASE WHEN changes() = 0
    THEN RAISE(ABORT, 'ZENGUY_USER_DAILY_RUN_CAP') END);

  INSERT INTO run_quota_counters
    (scope_kind, scope_id, window_kind, window_start, run_count)
  VALUES (
    'USER', NEW.triggered_by_user_id, 'MONTH',
    CAST(strftime('%s', NEW.created_at / 1000, 'unixepoch', 'start of month') AS INTEGER) * 1000,
    1
  )
  ON CONFLICT (scope_kind, scope_id, window_kind, window_start)
  DO UPDATE SET run_count = run_count + 1
  WHERE run_count < (
    SELECT max_monthly_runs_per_user FROM run_cost_limits WHERE id = 1
  );
  SELECT (CASE WHEN changes() = 0
    THEN RAISE(ABORT, 'ZENGUY_USER_MONTHLY_RUN_CAP') END);
END;

CREATE TRIGGER reserve_owner_run_quota
BEFORE INSERT ON test_runs
WHEN EXISTS (SELECT 1 FROM workspaces WHERE id = NEW.workspace_id)
BEGIN
  INSERT INTO run_quota_counters
    (scope_kind, scope_id, window_kind, window_start, run_count)
  VALUES (
    'OWNER', (SELECT owner_user_id FROM workspaces WHERE id = NEW.workspace_id),
    'DAY',
    CAST(strftime('%s', NEW.created_at / 1000, 'unixepoch', 'start of day') AS INTEGER) * 1000,
    1
  )
  ON CONFLICT (scope_kind, scope_id, window_kind, window_start)
  DO UPDATE SET run_count = run_count + 1
  WHERE run_count < (
    SELECT max_daily_runs_per_owner FROM run_cost_limits WHERE id = 1
  );
  SELECT (CASE WHEN changes() = 0
    THEN RAISE(ABORT, 'ZENGUY_OWNER_DAILY_RUN_CAP') END);

  INSERT INTO run_quota_counters
    (scope_kind, scope_id, window_kind, window_start, run_count)
  VALUES (
    'OWNER', (SELECT owner_user_id FROM workspaces WHERE id = NEW.workspace_id),
    'MONTH',
    CAST(strftime('%s', NEW.created_at / 1000, 'unixepoch', 'start of month') AS INTEGER) * 1000,
    1
  )
  ON CONFLICT (scope_kind, scope_id, window_kind, window_start)
  DO UPDATE SET run_count = run_count + 1
  WHERE run_count < (
    SELECT max_monthly_runs_per_owner FROM run_cost_limits WHERE id = 1
  );
  SELECT (CASE WHEN changes() = 0
    THEN RAISE(ABORT, 'ZENGUY_OWNER_MONTHLY_RUN_CAP') END);
END;

CREATE TRIGGER reserve_global_run_quota
BEFORE INSERT ON test_runs
BEGIN
  INSERT INTO run_quota_counters
    (scope_kind, scope_id, window_kind, window_start, run_count)
  VALUES (
    'GLOBAL', 'global', 'DAY',
    CAST(strftime('%s', NEW.created_at / 1000, 'unixepoch', 'start of day') AS INTEGER) * 1000,
    1
  )
  ON CONFLICT (scope_kind, scope_id, window_kind, window_start)
  DO UPDATE SET run_count = run_count + 1
  WHERE run_count < (
    SELECT max_daily_runs_global FROM run_cost_limits WHERE id = 1
  );
  SELECT (CASE WHEN changes() = 0
    THEN RAISE(ABORT, 'ZENGUY_GLOBAL_DAILY_RUN_CAP') END);

  INSERT INTO run_quota_counters
    (scope_kind, scope_id, window_kind, window_start, run_count)
  VALUES (
    'GLOBAL', 'global', 'MONTH',
    CAST(strftime('%s', NEW.created_at / 1000, 'unixepoch', 'start of month') AS INTEGER) * 1000,
    1
  )
  ON CONFLICT (scope_kind, scope_id, window_kind, window_start)
  DO UPDATE SET run_count = run_count + 1
  WHERE run_count < (
    SELECT max_monthly_runs_global FROM run_cost_limits WHERE id = 1
  );
  SELECT (CASE WHEN changes() = 0
    THEN RAISE(ABORT, 'ZENGUY_GLOBAL_MONTHLY_RUN_CAP') END);

  -- Retain the current and previous calendar month; older counters cannot
  -- affect either active quota window.
  DELETE FROM run_quota_counters
  WHERE window_start <
    CAST(strftime(
      '%s', NEW.created_at / 1000, 'unixepoch', 'start of month', '-1 month'
    ) AS INTEGER) * 1000;
END;

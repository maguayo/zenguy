-- BE-057 remote smoke seed. Development/test data only.
-- DEVIATION: Current Wrangler remote mode cannot run Queue consumers. Run the
-- Worker locally with remote D1, R2, and Browser bindings plus a local queue
-- consumer so the same API-to-browser execution path is exercised.
-- Login: backend-smoke@zenguy.test / ZenguySmoke2026!
-- Workspace ID: ws_backend_smoke

INSERT INTO users (
  id, name, email, password_hash, email_verified_at, created_at, updated_at
) VALUES (
  'usr_backend_smoke',
  'Backend Smoke',
  'backend-smoke@zenguy.test',
  'pbkdf2$100000$emVuZ3V5LXNtb2tlLXNhbHQ=$FWORxky+J3A9mZdlnMrxGaxWCG/B6MYxnXlyqC1PHo4=',
  1800000000000,
  1800000000000,
  1800000000000
) ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  email = excluded.email,
  password_hash = excluded.password_hash,
  email_verified_at = excluded.email_verified_at,
  updated_at = excluded.updated_at;

INSERT INTO workspaces (
  id, name, slug, timezone, owner_user_id, created_at, updated_at, deleted_at
) VALUES (
  'ws_backend_smoke',
  'Backend Smoke',
  'backend-smoke',
  'UTC',
  'usr_backend_smoke',
  1800000000000,
  1800000000000,
  NULL
) ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  slug = excluded.slug,
  timezone = excluded.timezone,
  owner_user_id = excluded.owner_user_id,
  updated_at = excluded.updated_at,
  deleted_at = NULL;

INSERT INTO workspace_members (
  id, workspace_id, user_id, role, invited_by, joined_at
) VALUES (
  'mem_backend_smoke',
  'ws_backend_smoke',
  'usr_backend_smoke',
  'OWNER',
  NULL,
  1800000000000
) ON CONFLICT(id) DO UPDATE SET
  workspace_id = excluded.workspace_id,
  user_id = excluded.user_id,
  role = excluded.role,
  joined_at = excluded.joined_at;

INSERT INTO subscriptions (
  id, workspace_id, provider, provider_customer_id,
  provider_subscription_id, status, period_start, period_end,
  cancel_at_period_end, update_payment_url, cancel_url, created_at, updated_at,
  source
) VALUES (
  'sub_backend_smoke',
  'ws_backend_smoke',
  'internal',
  NULL,
  NULL,
  'ACTIVE',
  1800000000000,
  4102444800000,
  0,
  NULL,
  NULL,
  1800000000000,
  1800000000000,
  'grant'
) ON CONFLICT(id) DO UPDATE SET
  workspace_id = excluded.workspace_id,
  status = excluded.status,
  period_start = excluded.period_start,
  period_end = excluded.period_end,
  cancel_at_period_end = 0,
  updated_at = excluded.updated_at;

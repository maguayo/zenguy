-- Workspaces created before the free launch may not have reached Paddle
-- checkout. Give only those workspaces the same active, non-billable plan that
-- all newly created workspaces receive. Existing Paddle and grant records are
-- deliberately preserved.
INSERT INTO subscriptions (
  id,
  workspace_id,
  provider,
  source,
  provider_customer_id,
  provider_subscription_id,
  status,
  period_start,
  period_end,
  cancel_at_period_end,
  update_payment_url,
  cancel_url,
  created_at,
  updated_at,
  last_provider_event_at
)
SELECT
  'sub_free_' || workspaces.id,
  workspaces.id,
  'internal',
  'free',
  NULL,
  NULL,
  'ACTIVE',
  NULL,
  NULL,
  0,
  NULL,
  NULL,
  workspaces.created_at,
  workspaces.updated_at,
  NULL
FROM workspaces
WHERE workspaces.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM subscriptions
    WHERE subscriptions.workspace_id = workspaces.id
  );

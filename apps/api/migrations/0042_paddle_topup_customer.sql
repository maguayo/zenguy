-- Pin the Paddle customer observed on the signed transaction.completed event.
-- Adjustment webhooks and reconciliation fail closed for legacy NULL rows until
-- operations backfill them from the corresponding Paddle transaction.
ALTER TABLE alert_credit_entries ADD COLUMN provider_customer_id TEXT;

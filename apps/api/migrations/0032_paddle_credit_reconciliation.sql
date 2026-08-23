-- Webhooks are not a complete accounting source: periodically compare each
-- Paddle-funded credit top-up with the provider's immutable adjustments.
ALTER TABLE alert_credit_entries ADD COLUMN provider_reconciled_at INTEGER;

CREATE INDEX idx_alert_credit_entries_reconcile
  ON alert_credit_entries (provider_reconciled_at, created_at)
  WHERE kind = 'TOPUP' AND provider_transaction_id IS NOT NULL;

CREATE INDEX idx_paddle_checkout_intents_expired
  ON paddle_checkout_intents (expires_at, consumed_at);

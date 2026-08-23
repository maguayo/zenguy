-- External providers cannot participate in a D1 transaction. Persist an
-- explicit dispatch state and a fencing token around every provider call so
-- an expired worker can never overwrite the current owner. A stale
-- DISPATCHING row becomes AMBIGUOUS and is not blindly sent again.
ALTER TABLE notification_deliveries
  ADD COLUMN dispatch_state TEXT NOT NULL DEFAULT 'READY'
  CHECK (dispatch_state IN ('READY','DISPATCHING','AMBIGUOUS','CONFIRMED'));
ALTER TABLE notification_deliveries ADD COLUMN dispatch_token TEXT;
ALTER TABLE notification_deliveries
  ADD COLUMN dispatch_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN provider_idempotency_key TEXT;

UPDATE notification_deliveries
SET dispatch_state = CASE
  WHEN status IN ('SENT','FAILED') THEN 'CONFIRMED'
  ELSE 'READY'
END,
provider_idempotency_key = id;

CREATE INDEX idx_deliveries_dispatch_recovery
  ON notification_deliveries(status, dispatch_state, processing_at, id);
CREATE UNIQUE INDEX idx_deliveries_provider_idempotency
  ON notification_deliveries(provider_idempotency_key)
  WHERE provider_idempotency_key IS NOT NULL;

-- Generation 1 is the original claim. An increment means a crashed owner was
-- fenced and the attempt was reclaimed. Mutable uptime requests never repeat
-- such a reclaimed execution; they persist an ambiguous result instead.
ALTER TABLE check_execution_claims
  ADD COLUMN claim_generation INTEGER NOT NULL DEFAULT 1;

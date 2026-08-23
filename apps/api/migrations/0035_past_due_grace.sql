-- Persist the first transition into PAST_DUE so repeated provider updates
-- cannot silently extend the execution grace period forever.
ALTER TABLE subscriptions ADD COLUMN past_due_since INTEGER;

UPDATE subscriptions
SET past_due_since = updated_at
WHERE status = 'PAST_DUE' AND past_due_since IS NULL;

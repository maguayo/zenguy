-- Pin the trusted Paddle product as well as its price on every new checkout
-- intent. Existing intents live for only 15 minutes and are deliberately left
-- with the impossible empty sentinel so they fail closed after this migration.
ALTER TABLE paddle_checkout_intents
  ADD COLUMN product_id TEXT NOT NULL DEFAULT '';

-- SQLite cannot add a CHECK constraint to an existing table. Reject empty
-- products on every post-migration insert/update while retaining the sentinel
-- solely for already-issued intents.
CREATE TRIGGER trg_paddle_checkout_intents_product_insert
BEFORE INSERT ON paddle_checkout_intents
WHEN length(trim(NEW.product_id)) = 0
BEGIN
  SELECT RAISE(ABORT, 'paddle checkout product_id is required');
END;

CREATE TRIGGER trg_paddle_checkout_intents_product_update
BEFORE UPDATE OF product_id ON paddle_checkout_intents
WHEN length(trim(NEW.product_id)) = 0
BEGIN
  SELECT RAISE(ABORT, 'paddle checkout product_id is required');
END;

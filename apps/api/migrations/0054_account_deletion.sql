-- Apple App Review 5.1.1(v): users who can access an account in the app can
-- delete it in the app. The user row is retained only as a non-identifying
-- tombstone so historical foreign-key/audit records remain structurally valid.
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
CREATE INDEX idx_users_deleted_at ON users(deleted_at);

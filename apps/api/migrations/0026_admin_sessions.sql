-- Short-lived, server-side sessions for admin.zenguy.com. Only the SHA-256
-- digest of the opaque browser token is stored so a database read cannot be
-- turned directly into an authenticated admin cookie.
CREATE TABLE admin_sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  auth_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_admin_sessions_user_active
  ON admin_sessions (user_id, revoked_at, expires_at);
CREATE INDEX idx_admin_sessions_expiry
  ON admin_sessions (expires_at);

-- Access-token revocation epoch. Every JWT carries the version observed when
-- it was issued; password resets and global session revocation increment it.
ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;

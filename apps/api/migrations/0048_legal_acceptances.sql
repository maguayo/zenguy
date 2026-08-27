-- Proof of terms/privacy acknowledgement and optional marketing consent
-- (GDPR art. 7.1; LSSI-CE art. 21). Kept off `users` so account fixtures
-- and older rows stay valid without backfilling.
CREATE TABLE user_legal_acceptances (
  user_id TEXT PRIMARY KEY,
  terms_accepted_at INTEGER NOT NULL,
  privacy_acknowledged_at INTEGER NOT NULL,
  marketing_opt_in_at INTEGER,
  legal_version TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

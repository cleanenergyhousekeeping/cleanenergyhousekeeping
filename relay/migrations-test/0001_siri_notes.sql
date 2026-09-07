/* begin[siri_test_schema] */
-- TEST ONLY. Deliberately outside the shared/production migration directory.
CREATE TABLE siri_credentials (
  credential_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  cleaner_subject TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  CHECK (expires_at_ms > issued_at_ms)
);

CREATE TABLE siri_requests (
  request_id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES siri_credentials(credential_id),
  cleaner_subject TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  payload_nonce TEXT NOT NULL,
  encryption_key_version INTEGER NOT NULL CHECK (encryption_key_version > 0),
  state TEXT NOT NULL DEFAULT 'accepted'
    CHECK (state IN ('accepted', 'waiting_shift', 'pinned', 'completed', 'needs_review')),
  pin_digest TEXT,
  pin_ciphertext TEXT,
  pin_nonce TEXT,
  pin_key_version INTEGER,
  accepted_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at_ms INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  failure_code TEXT,
  CHECK ((lease_owner IS NULL) = (lease_expires_at_ms IS NULL)),
  CHECK (
    (pin_digest IS NULL AND pin_ciphertext IS NULL AND pin_nonce IS NULL AND pin_key_version IS NULL)
    OR (pin_digest IS NOT NULL AND pin_ciphertext IS NOT NULL AND pin_nonce IS NOT NULL AND pin_key_version IS NOT NULL AND pin_key_version > 0)
  ),
  CHECK (state NOT IN ('pinned', 'completed') OR pin_digest IS NOT NULL),
  CHECK (state != 'completed' OR completed_at_ms IS NOT NULL)
);
CREATE INDEX siri_requests_due_idx ON siri_requests (state, next_attempt_at_ms, lease_expires_at_ms);
CREATE INDEX siri_requests_cleaner_idx ON siri_requests (cleaner_subject, accepted_at_ms);
/* end[siri_test_schema] */

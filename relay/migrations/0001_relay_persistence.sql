/* begin[relay_persistence_schema] */
PRAGMA foreign_keys = ON;

CREATE TABLE relay_sessions (
  session_id TEXT PRIMARY KEY,
  cleaner_subject TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  created_at_ms INTEGER NOT NULL,
  last_validated_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL,
  CHECK (length(session_id) > 0),
  CHECK (length(cleaner_subject) > 0),
  CHECK (length(device_id) > 0),
  CHECK (expires_at_ms > created_at_ms),
  CHECK (
    (status = 'revoked' AND revoked_at_ms IS NOT NULL)
    OR (status != 'revoked')
  )
);

CREATE INDEX relay_sessions_cleaner_status_idx
  ON relay_sessions (cleaner_subject, status, expires_at_ms);
CREATE INDEX relay_sessions_cleanup_idx
  ON relay_sessions (status, revoked_at_ms, expires_at_ms);

CREATE TABLE relay_session_tokens (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES relay_sessions(session_id) ON DELETE CASCADE,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  rotated_at_ms INTEGER,
  CHECK (length(token_hash) > 0),
  CHECK (expires_at_ms > issued_at_ms)
);

CREATE INDEX relay_session_tokens_session_idx
  ON relay_session_tokens (session_id, expires_at_ms);

CREATE TABLE relay_lanes (
  lane_id TEXT PRIMARY KEY,
  cleaner_subject TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'blocked')),
  next_delivery_sequence INTEGER NOT NULL DEFAULT 1
    CHECK (next_delivery_sequence > 0),
  highest_accepted_sequence INTEGER NOT NULL DEFAULT 0
    CHECK (highest_accepted_sequence >= 0),
  blocked_reason TEXT
    CHECK (blocked_reason IS NULL OR blocked_reason IN (
      'sequence_gap',
      'terminal_event',
      'operator_hold'
    )),
  blocked_at_ms INTEGER,
  gap_missing_from_sequence INTEGER,
  gap_missing_to_sequence INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (cleaner_subject, device_id),
  CHECK (length(lane_id) > 0),
  CHECK (length(cleaner_subject) > 0),
  CHECK (length(device_id) > 0),
  CHECK (
    (status = 'active'
      AND blocked_reason IS NULL
      AND blocked_at_ms IS NULL
      AND gap_missing_from_sequence IS NULL
      AND gap_missing_to_sequence IS NULL)
    OR
    (status = 'blocked'
      AND blocked_reason IS NOT NULL
      AND blocked_at_ms IS NOT NULL)
  ),
  CHECK (
    (blocked_reason = 'sequence_gap'
      AND gap_missing_from_sequence IS NOT NULL
      AND gap_missing_to_sequence IS NOT NULL
      AND gap_missing_from_sequence <= gap_missing_to_sequence)
    OR
    (blocked_reason != 'sequence_gap'
      AND gap_missing_from_sequence IS NULL
      AND gap_missing_to_sequence IS NULL)
    OR
    (blocked_reason IS NULL)
  )
);

CREATE INDEX relay_lanes_delivery_idx
  ON relay_lanes (status, next_delivery_sequence);

CREATE TABLE relay_events (
  event_id TEXT PRIMARY KEY,
  lane_id TEXT NOT NULL REFERENCES relay_lanes(lane_id) ON DELETE RESTRICT,
  device_sequence INTEGER NOT NULL CHECK (device_sequence > 0),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('clock_in', 'add_note', 'clock_out')),
  submitted_at_ms INTEGER NOT NULL,
  payload_digest TEXT NOT NULL,
  payload_ciphertext TEXT,
  payload_nonce TEXT,
  encryption_key_version INTEGER,
  state TEXT NOT NULL DEFAULT 'accepted'
    CHECK (state IN (
      'accepted',
      'pending',
      'delivering',
      'delivered',
      'retryable_failure',
      'attention_required',
      'terminal_failure'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at_ms INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  failure_category TEXT,
  accepted_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  delivered_at_ms INTEGER,
  attention_required_at_ms INTEGER,
  terminal_at_ms INTEGER,
  payload_redacted_at_ms INTEGER,
  UNIQUE (lane_id, device_sequence),
  CHECK (length(event_id) > 0),
  CHECK (length(payload_digest) > 0),
  CHECK (
    (payload_ciphertext IS NOT NULL
      AND payload_nonce IS NOT NULL
      AND encryption_key_version IS NOT NULL
      AND encryption_key_version > 0)
    OR
    (payload_ciphertext IS NULL
      AND payload_nonce IS NULL
      AND encryption_key_version IS NULL
      AND payload_redacted_at_ms IS NOT NULL)
  ),
  CHECK (
    (lease_owner IS NULL AND lease_expires_at_ms IS NULL)
    OR (lease_owner IS NOT NULL AND lease_expires_at_ms IS NOT NULL)
  ),
  CHECK (state != 'delivered' OR delivered_at_ms IS NOT NULL),
  CHECK (state != 'attention_required' OR attention_required_at_ms IS NOT NULL),
  CHECK (state != 'terminal_failure' OR terminal_at_ms IS NOT NULL)
);

CREATE INDEX relay_events_delivery_idx
  ON relay_events (state, next_attempt_at_ms, lease_expires_at_ms);
CREATE INDEX relay_events_lane_delivery_idx
  ON relay_events (lane_id, device_sequence, state);
CREATE INDEX relay_events_retention_idx
  ON relay_events (state, delivered_at_ms, payload_redacted_at_ms);

CREATE TABLE relay_state_snapshots (
  cleaner_subject TEXT PRIMARY KEY,
  state_ciphertext TEXT NOT NULL,
  state_nonce TEXT NOT NULL,
  encryption_key_version INTEGER NOT NULL CHECK (encryption_key_version > 0),
  source_updated_at_ms INTEGER NOT NULL,
  ledger_high_water_mark TEXT,
  expires_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK (length(cleaner_subject) > 0)
);

CREATE INDEX relay_state_snapshots_expiry_idx
  ON relay_state_snapshots (expires_at_ms);

CREATE TABLE notification_incidents (
  incident_id TEXT PRIMARY KEY,
  incident_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL
    CHECK (category IN (
      'terminal_business_rejection',
      'corrupted_event',
      'apps_google_outage',
      'authentication_failure',
      'stalled_backlog',
      'unresolved_event'
    )),
  scope_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'recovered')),
  opened_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  cooldown_until_ms INTEGER,
  recovered_at_ms INTEGER,
  CHECK (length(incident_id) > 0),
  CHECK (length(incident_key) > 0),
  CHECK (length(scope_hash) > 0),
  CHECK (
    (status = 'recovered' AND recovered_at_ms IS NOT NULL)
    OR (status = 'open' AND recovered_at_ms IS NULL)
  )
);

CREATE INDEX notification_incidents_status_idx
  ON notification_incidents (status, category, updated_at_ms);

CREATE TABLE incident_event_membership (
  incident_id TEXT NOT NULL REFERENCES notification_incidents(incident_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES relay_events(event_id) ON DELETE CASCADE,
  added_at_ms INTEGER NOT NULL,
  PRIMARY KEY (incident_id, event_id)
);

CREATE TABLE notification_outbox (
  notification_id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES notification_incidents(incident_id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL UNIQUE,
  transition_type TEXT NOT NULL
    CHECK (transition_type IN ('opened', 'escalated', 'recovered')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at_ms INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  sent_at_ms INTEGER,
  CHECK (
    (lease_owner IS NULL AND lease_expires_at_ms IS NULL)
    OR (lease_owner IS NOT NULL AND lease_expires_at_ms IS NOT NULL)
  ),
  CHECK (status != 'sent' OR sent_at_ms IS NOT NULL)
);

CREATE INDEX notification_outbox_delivery_idx
  ON notification_outbox (status, available_at_ms, lease_expires_at_ms);

CREATE TABLE relay_sequence_gap_resolutions (
  resolution_id TEXT PRIMARY KEY,
  lane_id TEXT NOT NULL REFERENCES relay_lanes(lane_id) ON DELETE RESTRICT,
  missing_from_sequence INTEGER NOT NULL CHECK (missing_from_sequence > 0),
  missing_to_sequence INTEGER NOT NULL CHECK (missing_to_sequence >= missing_from_sequence),
  resume_sequence INTEGER NOT NULL CHECK (resume_sequence = missing_to_sequence + 1),
  reason_code TEXT NOT NULL
    CHECK (reason_code IN ('lost_browser_storage', 'device_replacement', 'corruption')),
  operator_subject_hash TEXT NOT NULL,
  d1_verified_at_ms INTEGER NOT NULL,
  apps_ledger_verified_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  UNIQUE (lane_id, missing_from_sequence, missing_to_sequence),
  CHECK (length(resolution_id) > 0),
  CHECK (length(operator_subject_hash) > 0)
);

CREATE INDEX relay_sequence_gap_resolutions_lane_idx
  ON relay_sequence_gap_resolutions (lane_id, created_at_ms);
/* end[relay_persistence_schema] */

/* begin[relay_persistence_types] */
export const EVENT_TYPES = ["clock_in", "add_note", "clock_out"] as const;

export const EVENT_STATES = [
  "accepted",
  "pending",
  "delivering",
  "delivered",
  "retryable_failure",
  "attention_required",
  "terminal_failure",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type EventState = (typeof EVENT_STATES)[number];

export interface EncryptedValue {
  ciphertext: string;
  nonce: string;
  keyVersion: number;
}

export interface RelayEventRow {
  event_id: string;
  lane_id: string;
  device_sequence: number;
  event_type: EventType;
  submitted_at_ms: number;
  payload_digest: string;
  payload_ciphertext: string | null;
  payload_nonce: string | null;
  encryption_key_version: number | null;
  state: EventState;
  attempt_count: number;
  next_attempt_at_ms: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  failure_category: string | null;
  accepted_at_ms: number;
  updated_at_ms: number;
  delivered_at_ms: number | null;
  attention_required_at_ms: number | null;
  terminal_at_ms: number | null;
  payload_redacted_at_ms: number | null;
}

export interface RelayLaneRow {
  lane_id: string;
  cleaner_subject: string;
  device_id: string;
  status: "active" | "blocked";
  next_delivery_sequence: number;
  highest_accepted_sequence: number;
  blocked_reason: "sequence_gap" | "terminal_event" | "operator_hold" | null;
  blocked_at_ms: number | null;
  gap_missing_from_sequence: number | null;
  gap_missing_to_sequence: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface RelaySessionRow {
  session_id: string;
  cleaner_subject: string;
  device_id: string;
  status: "active" | "revoked" | "expired";
  created_at_ms: number;
  last_validated_at_ms: number;
  expires_at_ms: number;
  revoked_at_ms: number | null;
  updated_at_ms: number;
}

export type EventInsertResult =
  | { outcome: "inserted"; event: RelayEventRow }
  | { outcome: "identical_duplicate"; event: RelayEventRow }
  | { outcome: "event_id_conflict"; event: RelayEventRow }
  | { outcome: "sequence_conflict"; event: RelayEventRow };

export type TerminalFailureCategory =
  | "corrupt_event"
  | "event_id_conflict"
  | "sequence_conflict"
  | "invalid_payload"
  | "permanent_business_rejection"
  | "permanent_configuration_failure";

export type InfrastructureFailureCategory =
  | "apps_script_unavailable"
  | "google_unavailable"
  | "network_error"
  | "timeout"
  | "lock_contention"
  | "rate_limited"
  | "upstream_5xx";
/* end[relay_persistence_types] */

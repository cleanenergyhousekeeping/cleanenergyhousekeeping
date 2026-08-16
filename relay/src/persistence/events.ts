import type {
  EncryptedValue,
  DeliveryCandidateRow,
  EventInsertResult,
  EventState,
  EventType,
  InfrastructureFailureCategory,
  RelayEventRow,
  RelayLaneRow,
  SequenceGapCandidateRow,
  TerminalFailureCategory,
} from "./types";

/* begin[relay_event_repository] */
const NORMAL_RETRY_BASE_MS = 60_000;
const NORMAL_RETRY_MAX_MS = 24 * 60 * 60 * 1_000;
const ATTENTION_RETRY_MIN_MS = 6 * 60 * 60 * 1_000;
const ATTENTION_RETRY_RANGE_MS = 18 * 60 * 60 * 1_000;

const ALLOWED_TRANSITIONS: Readonly<Record<EventState, readonly EventState[]>> = {
  accepted: ["pending", "terminal_failure"],
  pending: ["delivering", "terminal_failure"],
  delivering: [
    "delivered",
    "retryable_failure",
    "attention_required",
    "terminal_failure",
  ],
  delivered: [],
  retryable_failure: ["delivering", "attention_required", "terminal_failure"],
  attention_required: ["delivering", "terminal_failure"],
  terminal_failure: [],
};

export interface EnsureLaneInput {
  laneId: string;
  cleanerSubject: string;
  deviceId: string;
  nowMs: number;
}

export async function ensureLane(
  db: D1Database,
  input: EnsureLaneInput,
): Promise<RelayLaneRow> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO relay_lanes (
         lane_id, cleaner_subject, device_id, created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      input.laneId,
      input.cleanerSubject,
      input.deviceId,
      input.nowMs,
      input.nowMs,
    )
    .run();

  const lane = await db
    .prepare(
      `SELECT * FROM relay_lanes
       WHERE cleaner_subject = ? AND device_id = ?`,
    )
    .bind(input.cleanerSubject, input.deviceId)
    .first<RelayLaneRow>();
  if (lane === null) {
    throw new Error("Relay lane could not be created");
  }
  return lane;
}

export interface InsertEventInput {
  eventId: string;
  laneId: string;
  deviceSequence: number;
  eventType: EventType;
  submittedAtMs: number;
  payloadDigest: string;
  encryptedPayload: EncryptedValue;
  acceptedAtMs: number;
}

export async function insertEvent(
  db: D1Database,
  input: InsertEventInput,
): Promise<EventInsertResult> {
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO relay_events (
           event_id, lane_id, device_sequence, event_type, submitted_at_ms,
           payload_digest, payload_ciphertext, payload_nonce,
           encryption_key_version, state, next_attempt_at_ms,
           accepted_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`,
      )
      .bind(
        input.eventId,
        input.laneId,
        input.deviceSequence,
        input.eventType,
        input.submittedAtMs,
        input.payloadDigest,
        input.encryptedPayload.ciphertext,
        input.encryptedPayload.nonce,
        input.encryptedPayload.keyVersion,
        input.acceptedAtMs,
        input.acceptedAtMs,
        input.acceptedAtMs,
      ),
    db
      .prepare(
        `UPDATE relay_lanes
         SET highest_accepted_sequence = MAX(highest_accepted_sequence, ?),
             updated_at_ms = ?
         WHERE lane_id = ?
           AND EXISTS (
             SELECT 1 FROM relay_events
             WHERE event_id = ? AND lane_id = ? AND device_sequence = ?
           )`,
      )
      .bind(
        input.deviceSequence,
        input.acceptedAtMs,
        input.laneId,
        input.eventId,
        input.laneId,
        input.deviceSequence,
      ),
  ]);

  const [eventById, eventBySequence] = await Promise.all([
    getEventOrNull(db, input.eventId),
    db
      .prepare(
        `SELECT * FROM relay_events
         WHERE lane_id = ? AND device_sequence = ?`,
      )
      .bind(input.laneId, input.deviceSequence)
      .first<RelayEventRow>(),
  ]);

  if ((results[0].meta.changes ?? 0) === 1 && eventById !== null) {
    return { outcome: "inserted", event: eventById };
  }
  if (
    eventById !== null &&
    eventById.lane_id === input.laneId &&
    eventById.device_sequence === input.deviceSequence &&
    eventById.event_type === input.eventType &&
    eventById.submitted_at_ms === input.submittedAtMs &&
    eventById.payload_digest === input.payloadDigest
  ) {
    return { outcome: "identical_duplicate", event: eventById };
  }
  if (eventById !== null) {
    return { outcome: "event_id_conflict", event: eventById };
  }
  if (eventBySequence !== null) {
    return { outcome: "sequence_conflict", event: eventBySequence };
  }
  throw new Error("D1 event insertion produced no durable result");
}

export function isEventStateTransitionAllowed(
  fromState: EventState,
  toState: EventState,
): boolean {
  return ALLOWED_TRANSITIONS[fromState].includes(toState);
}

export async function markEventPending(
  db: D1Database,
  eventId: string,
  nowMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE relay_events
       SET state = 'pending', updated_at_ms = ?
       WHERE event_id = ? AND state = 'accepted'`,
    )
    .bind(nowMs, eventId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function listDueLaneHeads(
  db: D1Database,
  nowMs: number,
  limit: number,
): Promise<DeliveryCandidateRow[]> {
  const boundedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
  const result = await db
    .prepare(
      `SELECT events.*, lanes.cleaner_subject, lanes.device_id
       FROM relay_lanes AS lanes
       JOIN relay_events AS events
         ON events.lane_id = lanes.lane_id
        AND events.device_sequence = lanes.next_delivery_sequence
       WHERE lanes.status = 'active'
         AND events.next_attempt_at_ms <= ?
         AND (
           events.state IN (
             'accepted', 'pending', 'retryable_failure', 'attention_required'
           )
           OR (
             events.state = 'delivering'
             AND events.lease_expires_at_ms <= ?
           )
         )
       ORDER BY events.next_attempt_at_ms ASC,
                events.accepted_at_ms ASC,
                events.event_id ASC
       LIMIT ?`,
    )
    .bind(nowMs, nowMs, boundedLimit)
    .all<DeliveryCandidateRow>();
  return result.results;
}

export async function listActiveSequenceGaps(
  db: D1Database,
  limit: number,
): Promise<SequenceGapCandidateRow[]> {
  const boundedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
  const result = await db
    .prepare(
      `SELECT lanes.lane_id,
              lanes.next_delivery_sequence AS missing_from_sequence,
              COALESCE(
                (
                  SELECT MIN(later.device_sequence) - 1
                  FROM relay_events AS later
                  WHERE later.lane_id = lanes.lane_id
                    AND later.device_sequence > lanes.next_delivery_sequence
                ),
                lanes.highest_accepted_sequence
              ) AS missing_to_sequence
       FROM relay_lanes AS lanes
       WHERE lanes.status = 'active'
         AND lanes.highest_accepted_sequence >= lanes.next_delivery_sequence
         AND NOT EXISTS (
           SELECT 1 FROM relay_events AS expected
           WHERE expected.lane_id = lanes.lane_id
             AND expected.device_sequence = lanes.next_delivery_sequence
         )
       ORDER BY lanes.updated_at_ms ASC, lanes.lane_id ASC
       LIMIT ?`,
    )
    .bind(boundedLimit)
    .all<SequenceGapCandidateRow>();
  return result.results;
}

export async function claimEventLease(
  db: D1Database,
  eventId: string,
  leaseOwner: string,
  nowMs: number,
  leaseDurationMs: number,
): Promise<RelayEventRow | null> {
  const leaseExpiresAtMs = nowMs + leaseDurationMs;
  return db
    .prepare(
      `UPDATE relay_events
       SET state = 'delivering', lease_owner = ?, lease_expires_at_ms = ?,
           attempt_count = attempt_count + 1, updated_at_ms = ?
       WHERE event_id = ?
         AND next_attempt_at_ms <= ?
         AND (
           state IN ('pending', 'retryable_failure', 'attention_required')
           OR (state = 'delivering' AND lease_expires_at_ms <= ?)
         )
         AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)
         AND EXISTS (
           SELECT 1 FROM relay_lanes AS lanes
           WHERE lanes.lane_id = relay_events.lane_id
             AND lanes.status = 'active'
             AND lanes.next_delivery_sequence = relay_events.device_sequence
         )
       RETURNING *`,
    )
    .bind(
      leaseOwner,
      leaseExpiresAtMs,
      nowMs,
      eventId,
      nowMs,
      nowMs,
      nowMs,
    )
    .first<RelayEventRow>();
}

export async function releaseEventLease(
  db: D1Database,
  eventId: string,
  leaseOwner: string,
  nowMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE relay_events
       SET state = 'pending', lease_owner = NULL, lease_expires_at_ms = NULL,
           updated_at_ms = ?
       WHERE event_id = ? AND state = 'delivering' AND lease_owner = ?`,
    )
    .bind(nowMs, eventId, leaseOwner)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export function calculateRetryDelayMs(
  attemptCount: number,
  attentionRequired: boolean,
  randomUnit = crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff,
): number {
  const boundedRandomUnit = Math.min(1, Math.max(0, randomUnit));
  if (attentionRequired) {
    return Math.round(
      ATTENTION_RETRY_MIN_MS + ATTENTION_RETRY_RANGE_MS * boundedRandomUnit,
    );
  }

  const exponent = Math.max(0, attemptCount - 1);
  const baseDelay = Math.min(
    NORMAL_RETRY_MAX_MS,
    NORMAL_RETRY_BASE_MS * 2 ** exponent,
  );
  const jitteredDelay = baseDelay * (0.8 + boundedRandomUnit * 0.4);
  return Math.round(Math.min(NORMAL_RETRY_MAX_MS, jitteredDelay));
}

export async function scheduleInfrastructureFailure(
  db: D1Database,
  input: {
    eventId: string;
    leaseOwner: string;
    category: InfrastructureFailureCategory;
    nowMs: number;
    nextAttemptAtMs: number;
    attentionRequired: boolean;
  },
): Promise<boolean> {
  const nextState: EventState = input.attentionRequired
    ? "attention_required"
    : "retryable_failure";
  const result = await db
    .prepare(
      `UPDATE relay_events
       SET state = ?, failure_category = ?, next_attempt_at_ms = ?,
           attention_required_at_ms = CASE
             WHEN ? = 'attention_required' THEN COALESCE(attention_required_at_ms, ?)
             ELSE attention_required_at_ms
           END,
           lease_owner = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
       WHERE event_id = ? AND state = 'delivering' AND lease_owner = ?`,
    )
    .bind(
      nextState,
      input.category,
      input.nextAttemptAtMs,
      nextState,
      input.nowMs,
      input.nowMs,
      input.eventId,
      input.leaseOwner,
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function markEventDelivered(
  db: D1Database,
  eventId: string,
  leaseOwner: string,
  nowMs: number,
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE relay_events
         SET state = 'delivered', delivered_at_ms = ?, failure_category = NULL,
             lease_owner = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
         WHERE event_id = ? AND state = 'delivering' AND lease_owner = ?`,
      )
      .bind(nowMs, nowMs, eventId, leaseOwner),
    db
      .prepare(
        `UPDATE relay_lanes
         SET next_delivery_sequence = next_delivery_sequence + 1, updated_at_ms = ?
         WHERE status = 'active'
           AND next_delivery_sequence = (
             SELECT device_sequence FROM relay_events
             WHERE event_id = ? AND state = 'delivered' AND delivered_at_ms = ?
           )
           AND lane_id = (SELECT lane_id FROM relay_events WHERE event_id = ?)`,
      )
      .bind(nowMs, eventId, nowMs, eventId),
    db
      .prepare(
        `UPDATE relay_lanes
         SET status = 'blocked', blocked_reason = 'terminal_event',
             blocked_at_ms = ?, updated_at_ms = ?
         WHERE status = 'active'
           AND lane_id = (SELECT lane_id FROM relay_events WHERE event_id = ?)
           AND EXISTS (
             SELECT 1 FROM relay_events
             WHERE lane_id = relay_lanes.lane_id
               AND device_sequence = relay_lanes.next_delivery_sequence
               AND state = 'terminal_failure'
           )`,
      )
      .bind(nowMs, nowMs, eventId),
  ]);
  return (results[0].meta.changes ?? 0) === 1;
}

interface TerminalFailureInput {
  eventId: string;
  category: TerminalFailureCategory;
  nowMs: number;
}

export async function markPreDeliveryTerminalFailure(
  db: D1Database,
  input: TerminalFailureInput,
): Promise<boolean> {
  return applyTerminalFailure(
    db,
    input,
    "pre_delivery",
    null,
  );
}

export async function markLeasedTerminalFailure(
  db: D1Database,
  input: TerminalFailureInput & { leaseOwner: string },
): Promise<boolean> {
  return applyTerminalFailure(
    db,
    input,
    "leased",
    input.leaseOwner,
  );
}

async function applyTerminalFailure(
  db: D1Database,
  input: TerminalFailureInput,
  transitionMode: "pre_delivery" | "leased",
  leaseOwner: string | null,
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE relay_events
         SET state = 'terminal_failure', failure_category = ?, terminal_at_ms = ?,
             lease_owner = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
         WHERE event_id = ?
           AND (
             (? = 'pre_delivery'
               AND state IN (
                 'accepted', 'pending', 'retryable_failure', 'attention_required'
               )
               AND lease_owner IS NULL
               AND lease_expires_at_ms IS NULL)
             OR
             (? = 'leased'
               AND state = 'delivering'
               AND lease_owner = ?
               AND lease_expires_at_ms > ?)
           )`,
      )
      .bind(
        input.category,
        input.nowMs,
        input.nowMs,
        input.eventId,
        transitionMode,
        transitionMode,
        leaseOwner,
        input.nowMs,
      ),
    db
      .prepare(
        `UPDATE relay_lanes
         SET status = 'blocked', blocked_reason = 'terminal_event', blocked_at_ms = ?,
             gap_missing_from_sequence = NULL, gap_missing_to_sequence = NULL,
             updated_at_ms = ?
         WHERE lane_id = (
           SELECT lane_id FROM relay_events
           WHERE event_id = ? AND state = 'terminal_failure' AND terminal_at_ms = ?
         )
           AND next_delivery_sequence = (
             SELECT device_sequence FROM relay_events WHERE event_id = ?
           )`,
      )
      .bind(
        input.nowMs,
        input.nowMs,
        input.eventId,
        input.nowMs,
        input.eventId,
      ),
  ]);
  return (results[0].meta.changes ?? 0) === 1;
}

export async function blockLaneForSequenceGap(
  db: D1Database,
  input: {
    laneId: string;
    missingFromSequence: number;
    missingToSequence: number;
    nowMs: number;
  },
): Promise<boolean> {
  if (
    input.missingFromSequence < 1 ||
    input.missingToSequence < input.missingFromSequence
  ) {
    return false;
  }

  const result = await db
    .prepare(
      `UPDATE relay_lanes
       SET status = 'blocked', blocked_reason = 'sequence_gap', blocked_at_ms = ?,
           gap_missing_from_sequence = ?, gap_missing_to_sequence = ?,
           updated_at_ms = ?
       WHERE lane_id = ? AND status = 'active'
         AND next_delivery_sequence = ?`,
    )
    .bind(
      input.nowMs,
      input.missingFromSequence,
      input.missingToSequence,
      input.nowMs,
      input.laneId,
      input.missingFromSequence,
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function resolveSequenceGap(
  db: D1Database,
  input: {
    resolutionId: string;
    laneId: string;
    missingFromSequence: number;
    missingToSequence: number;
    reasonCode: "lost_browser_storage" | "device_replacement" | "corruption";
    operatorSubjectHash: string;
    d1VerifiedAtMs: number;
    appsLedgerVerifiedAtMs: number;
    nowMs: number;
  },
): Promise<boolean> {
  if (
    input.missingFromSequence < 1 ||
    input.missingToSequence < input.missingFromSequence
  ) {
    return false;
  }

  const resumeSequence = input.missingToSequence + 1;
  const results = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO relay_sequence_gap_resolutions (
           resolution_id, lane_id, missing_from_sequence, missing_to_sequence,
           resume_sequence, reason_code, operator_subject_hash,
           d1_verified_at_ms, apps_ledger_verified_at_ms, created_at_ms
         )
         SELECT ?, lane_id, ?, ?, ?, ?, ?, ?, ?, ?
         FROM relay_lanes
         WHERE lane_id = ?
           AND status = 'blocked'
           AND blocked_reason = 'sequence_gap'
           AND gap_missing_from_sequence = ?
           AND gap_missing_to_sequence = ?
           AND NOT EXISTS (
             SELECT 1 FROM relay_events
             WHERE lane_id = ? AND device_sequence BETWEEN ? AND ?
           )`,
      )
      .bind(
        input.resolutionId,
        input.missingFromSequence,
        input.missingToSequence,
        resumeSequence,
        input.reasonCode,
        input.operatorSubjectHash,
        input.d1VerifiedAtMs,
        input.appsLedgerVerifiedAtMs,
        input.nowMs,
        input.laneId,
        input.missingFromSequence,
        input.missingToSequence,
        input.laneId,
        input.missingFromSequence,
        input.missingToSequence,
      ),
    db
      .prepare(
        `UPDATE relay_lanes
         SET status = 'active', next_delivery_sequence = ?, blocked_reason = NULL,
             blocked_at_ms = NULL, gap_missing_from_sequence = NULL,
             gap_missing_to_sequence = NULL, updated_at_ms = ?
         WHERE lane_id = ?
           AND status = 'blocked'
           AND blocked_reason = 'sequence_gap'
           AND gap_missing_from_sequence = ?
           AND gap_missing_to_sequence = ?
           AND EXISTS (
             SELECT 1 FROM relay_sequence_gap_resolutions
             WHERE resolution_id = ? AND lane_id = ? AND created_at_ms = ?
           )`,
      )
      .bind(
        resumeSequence,
        input.nowMs,
        input.laneId,
        input.missingFromSequence,
        input.missingToSequence,
        input.resolutionId,
        input.laneId,
        input.nowMs,
      ),
  ]);
  return (results[0].meta.changes ?? 0) === 1;
}

export async function getEvent(
  db: D1Database,
  eventId: string,
): Promise<RelayEventRow> {
  const event = await getEventOrNull(db, eventId);
  if (event === null) {
    throw new Error("Relay event was not found");
  }
  return event;
}

async function getEventOrNull(
  db: D1Database,
  eventId: string,
): Promise<RelayEventRow | null> {
  return db
    .prepare("SELECT * FROM relay_events WHERE event_id = ?")
    .bind(eventId)
    .first<RelayEventRow>();
}
/* end[relay_event_repository] */

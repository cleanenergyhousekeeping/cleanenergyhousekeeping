import { callAppsScript, type AppsCallOutcome } from "./apps-script-client";
import type { RelayConfig } from "./config";
import {
  decryptJson,
  digestCanonicalEvent,
  eventEncryptionContext,
  generateSecureId,
  stringsEqualConstantTime,
} from "./crypto";
import {
  blockLaneForSequenceGap,
  calculateRetryDelayMs,
  claimEventLease,
  listActiveSequenceGaps,
  listDueLaneHeads,
  markEventDelivered,
  markEventPending,
  markLeasedTerminalFailure,
  scheduleInfrastructureFailure,
} from "./persistence/events";
import type {
  DeliveryCandidateRow,
  EventType,
  InfrastructureFailureCategory,
  TerminalFailureCategory,
} from "./persistence/types";

/* begin[relay_delivery_service] */
export const DELIVERY_CRON = "*/5 * * * *";
export const DELIVERY_BATCH_LIMIT = 25;
export const DELIVERY_CONCURRENCY = 5;
export const DELIVERY_LEASE_MS = 2 * 60 * 1_000;
export const ATTENTION_REQUIRED_AGE_MS = 60 * 60 * 1_000;
export const ATTENTION_REQUIRED_MIN_ATTEMPTS = 2;

interface DecryptedEventPayload {
  eventId: string;
  cleanerSubject: string;
  deviceId: string;
  deviceSequence: number;
  eventType: EventType;
  submittedAtMs: number;
  property: string;
  note: string;
}

export interface DeliveryDependencies {
  callApps?: typeof callAppsScript;
  now?: () => number;
  randomUnit?: () => number;
}

export interface DeliveryBatchSummary {
  selected: number;
  delivered: number;
  retryable: number;
  attentionRequired: number;
  terminal: number;
  skipped: number;
  gapsBlocked: number;
}

type DeliveryOutcome =
  | "delivered"
  | "retryable"
  | "attention_required"
  | "terminal"
  | "skipped";

const RETRYABLE_RESULTS: Readonly<Record<string, InfrastructureFailureCategory>> = {
  lock_busy: "lock_contention",
  stale_request: "apps_script_stale_request",
  replay_detected: "apps_script_replay",
  temporary_google_failure: "google_unavailable",
  internal_error: "apps_script_unavailable",
  authentication_failed: "apps_script_authentication",
};

const TERMINAL_RESULTS: Readonly<Record<string, TerminalFailureCategory>> = {
  event_conflict: "event_id_conflict",
  invalid_event: "invalid_payload",
  business_rejected: "permanent_business_rejection",
};

function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function validateDecryptedEvent(
  value: unknown,
  candidate: DeliveryCandidateRow,
): DecryptedEventPayload | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  const expectedKeys = [
    "cleanerSubject",
    "deviceId",
    "deviceSequence",
    "eventId",
    "eventType",
    "note",
    "property",
    "submittedAtMs",
  ];
  if (keys.join("\n") !== expectedKeys.join("\n")) {
    return null;
  }
  if (
    payload.eventId !== candidate.event_id ||
    payload.cleanerSubject !== candidate.cleaner_subject ||
    payload.deviceId !== candidate.device_id ||
    payload.deviceSequence !== candidate.device_sequence ||
    payload.eventType !== candidate.event_type ||
    payload.submittedAtMs !== candidate.submitted_at_ms ||
    typeof payload.property !== "string" ||
    payload.property.length === 0 ||
    payload.property.length > 500 ||
    typeof payload.note !== "string" ||
    countCodePoints(payload.note) > 1_000 ||
    (candidate.event_type === "add_note" && payload.note.length === 0)
  ) {
    return null;
  }
  return payload as unknown as DecryptedEventPayload;
}

function canonicalEvent(payload: DecryptedEventPayload): Record<string, unknown> {
  return {
    eventId: payload.eventId,
    cleanerSubject: payload.cleanerSubject,
    deviceId: payload.deviceId,
    deviceSequence: payload.deviceSequence,
    eventType: payload.eventType,
    submittedAtMs: payload.submittedAtMs,
    property: payload.property,
    note: payload.note,
  };
}

function requiresAttention(candidate: DeliveryCandidateRow, nowMs: number): boolean {
  return (
    nowMs - candidate.accepted_at_ms >= ATTENTION_REQUIRED_AGE_MS &&
    candidate.attempt_count >= ATTENTION_REQUIRED_MIN_ATTEMPTS
  );
}

async function scheduleFailure(
  db: D1Database,
  candidate: DeliveryCandidateRow,
  leaseOwner: string,
  category: InfrastructureFailureCategory,
  nowMs: number,
  retryAfterMs: number | undefined,
  randomUnit: number,
): Promise<DeliveryOutcome> {
  const attentionRequired = requiresAttention(candidate, nowMs);
  const scheduledDelay = calculateRetryDelayMs(
    candidate.attempt_count,
    attentionRequired,
    randomUnit,
  );
  const delayMs = Math.max(scheduledDelay, retryAfterMs ?? 0);
  const updated = await scheduleInfrastructureFailure(db, {
    eventId: candidate.event_id,
    leaseOwner,
    category,
    nowMs,
    nextAttemptAtMs: nowMs + delayMs,
    attentionRequired,
  });
  if (!updated) {
    return "skipped";
  }
  return attentionRequired ? "attention_required" : "retryable";
}

async function markTerminal(
  db: D1Database,
  candidate: DeliveryCandidateRow,
  leaseOwner: string,
  category: TerminalFailureCategory,
  nowMs: number,
): Promise<DeliveryOutcome> {
  return (await markLeasedTerminalFailure(db, {
    eventId: candidate.event_id,
    category,
    leaseOwner,
    nowMs,
  }))
    ? "terminal"
    : "skipped";
}

async function handleAppsOutcome(
  db: D1Database,
  candidate: DeliveryCandidateRow,
  leaseOwner: string,
  outcome: AppsCallOutcome,
  nowMs: number,
  randomUnit: number,
): Promise<DeliveryOutcome> {
  if (outcome.kind === "failure") {
    return scheduleFailure(
      db,
      candidate,
      leaseOwner,
      outcome.category,
      nowMs,
      outcome.retryAfterMs,
      randomUnit,
    );
  }

  const response = outcome.response;
  const responseData =
    response.data !== null &&
    !Array.isArray(response.data) &&
    typeof response.data === "object"
      ? (response.data as Record<string, unknown>)
      : null;
  if (
    response.ok &&
    response.operation === "submit_event" &&
    (response.result === "applied" || response.result === "already_applied") &&
    responseData?.eventId === candidate.event_id
  ) {
    return (await markEventDelivered(db, candidate.event_id, leaseOwner, nowMs))
      ? "delivered"
      : "skipped";
  }

  const retryCategory = RETRYABLE_RESULTS[response.result];
  if (retryCategory !== undefined) {
    return scheduleFailure(
      db,
      candidate,
      leaseOwner,
      retryCategory,
      nowMs,
      undefined,
      randomUnit,
    );
  }
  const terminalCategory = TERMINAL_RESULTS[response.result];
  if (terminalCategory !== undefined && response.operation === "submit_event") {
    return markTerminal(db, candidate, leaseOwner, terminalCategory, nowMs);
  }
  return scheduleFailure(
    db,
    candidate,
    leaseOwner,
    "apps_script_protocol_error",
    nowMs,
    undefined,
    randomUnit,
  );
}

async function deliverCandidate(
  db: D1Database,
  config: RelayConfig,
  candidate: DeliveryCandidateRow,
  dependencies: DeliveryDependencies,
): Promise<DeliveryOutcome> {
  const nowMs = dependencies.now?.() ?? Date.now();
  if (candidate.state === "accepted") {
    await markEventPending(db, candidate.event_id, nowMs);
  }
  const leaseOwner = generateSecureId("lease");
  const claimed = await claimEventLease(
    db,
    candidate.event_id,
    leaseOwner,
    nowMs,
    DELIVERY_LEASE_MS,
  );
  if (claimed === null) {
    return "skipped";
  }
  const leasedCandidate: DeliveryCandidateRow = {
    ...claimed,
    cleaner_subject: candidate.cleaner_subject,
    device_id: candidate.device_id,
  };

  let decrypted: unknown;
  try {
    if (
      claimed.payload_ciphertext === null ||
      claimed.payload_nonce === null ||
      claimed.encryption_key_version === null
    ) {
      return markTerminal(db, leasedCandidate, leaseOwner, "corrupt_event", nowMs);
    }
    decrypted = await decryptJson(
      {
        ciphertext: claimed.payload_ciphertext,
        nonce: claimed.payload_nonce,
        keyVersion: claimed.encryption_key_version,
      },
      config.payloadEncryptionKeys,
      eventEncryptionContext(config.environment, claimed.event_id),
    );
  } catch (_) {
    return markTerminal(db, leasedCandidate, leaseOwner, "corrupt_event", nowMs);
  }

  const payload = validateDecryptedEvent(decrypted, leasedCandidate);
  decrypted = undefined;
  if (payload === null) {
    return markTerminal(db, leasedCandidate, leaseOwner, "corrupt_event", nowMs);
  }
  const digest = await digestCanonicalEvent(
    canonicalEvent(payload),
    config.eventDigestHmacKey,
    config.environment,
  );
  if (!stringsEqualConstantTime(digest, claimed.payload_digest)) {
    return markTerminal(db, leasedCandidate, leaseOwner, "corrupt_event", nowMs);
  }

  const outcome = await (dependencies.callApps ?? callAppsScript)(
    config,
    "submit_event",
    {
      eventId: payload.eventId,
      payloadDigest: claimed.payload_digest,
      cleanerSubject: payload.cleanerSubject,
      deviceId: payload.deviceId,
      deviceSequence: payload.deviceSequence,
      eventType: payload.eventType,
      submittedAtMs: payload.submittedAtMs,
      property: payload.property,
      note: payload.note,
    },
    { nowMs },
  );
  return handleAppsOutcome(
    db,
    leasedCandidate,
    leaseOwner,
    outcome,
    nowMs,
    dependencies.randomUnit?.() ??
      crypto.getRandomValues(new Uint32Array(1))[0] / 0xffffffff,
  );
}

async function processWithConcurrency(
  candidates: DeliveryCandidateRow[],
  concurrency: number,
  process: (candidate: DeliveryCandidateRow) => Promise<DeliveryOutcome>,
): Promise<DeliveryOutcome[]> {
  const outcomes: DeliveryOutcome[] = [];
  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    outcomes.push(
      ...(await Promise.all(candidates.slice(offset, offset + concurrency).map(process))),
    );
  }
  return outcomes;
}

export async function runDeliveryBatch(
  db: D1Database,
  config: RelayConfig,
  dependencies: DeliveryDependencies = {},
): Promise<DeliveryBatchSummary> {
  const nowMs = dependencies.now?.() ?? Date.now();
  const gaps = await listActiveSequenceGaps(db, DELIVERY_BATCH_LIMIT);
  let gapsBlocked = 0;
  for (const gap of gaps) {
    if (
      await blockLaneForSequenceGap(db, {
        laneId: gap.lane_id,
        missingFromSequence: gap.missing_from_sequence,
        missingToSequence: gap.missing_to_sequence,
        nowMs,
      })
    ) {
      gapsBlocked += 1;
    }
  }

  const candidates = await listDueLaneHeads(db, nowMs, DELIVERY_BATCH_LIMIT);
  const outcomes = await processWithConcurrency(
    candidates,
    DELIVERY_CONCURRENCY,
    (candidate) => deliverCandidate(db, config, candidate, dependencies),
  );
  return {
    selected: candidates.length,
    delivered: outcomes.filter((outcome) => outcome === "delivered").length,
    retryable: outcomes.filter((outcome) => outcome === "retryable").length,
    attentionRequired: outcomes.filter(
      (outcome) => outcome === "attention_required",
    ).length,
    terminal: outcomes.filter((outcome) => outcome === "terminal").length,
    skipped: outcomes.filter((outcome) => outcome === "skipped").length,
    gapsBlocked,
  };
}
/* end[relay_delivery_service] */

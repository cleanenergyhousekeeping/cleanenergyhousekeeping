import type { RelayConfig } from "./config";
import {
  digestCanonicalEvent,
  encryptJson,
  eventEncryptionContext,
  generateSecureId,
  hashRelayToken,
} from "./crypto";
import { ensureLane, insertEvent } from "./persistence/events";
import { findActiveSessionByTokenHash } from "./persistence/sessions";
import { EVENT_TYPES, type EventType } from "./persistence/types";
import { PROPOSED_NOTE_MAX_CHARACTERS } from "./validation";

/* begin[relay_event_acceptance_service] */
export const EVENT_REQUEST_MAX_BYTES = 8_192;
export const EVENT_PROPERTY_MAX_CHARACTERS = 500;

const EVENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{15,127}$/u;
const RELAY_TOKEN_PATTERN = /^relay_[A-Za-z0-9_-]{43}$/u;
const EVENT_REQUEST_KEYS = [
  "deviceSequence",
  "eventId",
  "eventType",
  "note",
  "property",
  "submittedAtMs",
] as const;

export interface RelayEventRequestInput {
  eventId: string;
  deviceSequence: number;
  eventType: EventType;
  submittedAtMs: number;
  property: string;
  note: string;
}

export interface RelayCanonicalEvent extends RelayEventRequestInput {
  [key: string]: unknown;
  cleanerSubject: string;
  deviceId: string;
}

export type EventAcceptanceResult =
  | {
      ok: true;
      outcome: "inserted" | "identical_duplicate";
      eventId: string;
    }
  | {
      ok: false;
      error:
        | "invalid_request"
        | "authentication_failed"
        | "event_conflict"
        | "temporarily_unavailable";
      retryable: boolean;
    };

export interface EventAcceptanceDependencies {
  nowMs?: number;
}

function failure(
  error: Exclude<EventAcceptanceResult, { ok: true }>["error"],
  retryable: boolean,
): EventAcceptanceResult {
  return { ok: false, error, retryable };
}

export async function parseRelayEventRequest(request: Request): Promise<unknown | null> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return null;
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > EVENT_REQUEST_MAX_BYTES) {
    return null;
  }

  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > EVENT_REQUEST_MAX_BYTES) {
      return null;
    }
    const parsed = JSON.parse(rawBody) as unknown;
    return parsed !== null && !Array.isArray(parsed) && typeof parsed === "object"
      ? parsed
      : null;
  } catch (_) {
    return null;
  }
}

function validateEventInput(value: unknown): RelayEventRequestInput | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join("\n") !== EVENT_REQUEST_KEYS.join("\n")) {
    return null;
  }
  if (
    typeof input.eventId !== "string" ||
    !EVENT_ID_PATTERN.test(input.eventId) ||
    !Number.isSafeInteger(input.deviceSequence) ||
    Number(input.deviceSequence) < 1 ||
    typeof input.eventType !== "string" ||
    !EVENT_TYPES.includes(input.eventType as EventType) ||
    !Number.isSafeInteger(input.submittedAtMs) ||
    Number(input.submittedAtMs) < 1 ||
    typeof input.property !== "string" ||
    input.property.length < 1 ||
    input.property.length > EVENT_PROPERTY_MAX_CHARACTERS ||
    typeof input.note !== "string" ||
    Array.from(input.note).length > PROPOSED_NOTE_MAX_CHARACTERS ||
    (input.eventType === "add_note" && input.note.trim().length === 0)
  ) {
    return null;
  }

  return {
    eventId: input.eventId,
    deviceSequence: Number(input.deviceSequence),
    eventType: input.eventType as EventType,
    submittedAtMs: Number(input.submittedAtMs),
    property: input.property,
    note: input.note,
  };
}

export async function acceptRelayEvent(
  db: D1Database,
  config: RelayConfig,
  bearerToken: string,
  requestInput: unknown,
  dependencies: EventAcceptanceDependencies = {},
): Promise<EventAcceptanceResult> {
  const input = validateEventInput(requestInput);
  if (input === null) {
    return failure("invalid_request", false);
  }
  if (!RELAY_TOKEN_PATTERN.test(bearerToken)) {
    return failure("authentication_failed", false);
  }

  const nowMs = dependencies.nowMs ?? Date.now();
  let session;
  try {
    const tokenHash = await hashRelayToken(
      bearerToken,
      config.relayTokenHmacKey,
      config.environment,
    );
    session = await findActiveSessionByTokenHash(db, tokenHash, nowMs);
  } catch (_) {
    return failure("temporarily_unavailable", true);
  }
  if (session === null) {
    return failure("authentication_failed", false);
  }

  const canonicalEvent: RelayCanonicalEvent = {
    eventId: input.eventId,
    cleanerSubject: session.cleaner_subject,
    deviceId: session.device_id,
    deviceSequence: input.deviceSequence,
    eventType: input.eventType,
    submittedAtMs: input.submittedAtMs,
    property: input.property,
    note: input.note,
  };

  try {
    const payloadDigest = await digestCanonicalEvent(
      canonicalEvent,
      config.eventDigestHmacKey,
      config.environment,
    );
    const encryptionKey = config.payloadEncryptionKeys.get(
      config.payloadActiveKeyVersion,
    );
    if (encryptionKey === undefined) {
      return failure("temporarily_unavailable", true);
    }
    const encryptedPayload = await encryptJson(
      canonicalEvent,
      encryptionKey,
      config.payloadActiveKeyVersion,
      eventEncryptionContext(config.environment, input.eventId),
    );
    const lane = await ensureLane(db, {
      laneId: generateSecureId("lane"),
      cleanerSubject: session.cleaner_subject,
      deviceId: session.device_id,
      nowMs,
    });
    const result = await insertEvent(db, {
      eventId: input.eventId,
      laneId: lane.lane_id,
      deviceSequence: input.deviceSequence,
      eventType: input.eventType,
      submittedAtMs: input.submittedAtMs,
      payloadDigest,
      encryptedPayload,
      acceptedAtMs: nowMs,
    });

    if (result.outcome === "inserted" || result.outcome === "identical_duplicate") {
      return { ok: true, outcome: result.outcome, eventId: input.eventId };
    }
    return failure("event_conflict", false);
  } catch (_) {
    return failure("temporarily_unavailable", true);
  }
}
/* end[relay_event_acceptance_service] */

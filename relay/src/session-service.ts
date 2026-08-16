import { callAppsScript, type AppsCallOutcome } from "./apps-script-client";
import type { RelayConfig } from "./config";
import { generateSecureId, hashRelayToken } from "./crypto";
import {
  createSession,
  findActiveSessionByTokenHash,
  RELAY_TOKEN_LIFETIME_MS,
  rotateSessionToken,
} from "./persistence/sessions";

/* begin[relay_session_service] */
const DEVICE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{15,127}$/u;
const APPS_SESSION_PATTERN = /^[A-Za-z0-9_-]{16,256}$/u;
const CLEANER_SUBJECT_PATTERN = /^cehusr_v1_[A-Za-z0-9_-]{43}$/u;

export interface SessionRequestInput {
  appsSessionToken: string;
  deviceId: string;
}

export interface RelaySessionResponseData {
  relayToken: string;
  expiresAtMs: number;
  cleanerSubject: string;
  cleanerDisplayName: string;
  deviceId: string;
  currentShift:
    | { open: false }
    | { open: true; property: string; clockInMs: number };
  ledgerHighWater: {
    deviceId: string;
    appliedThroughSequence: number;
  };
}

export type SessionServiceResult =
  | { ok: true; data: RelaySessionResponseData }
  | {
      ok: false;
      error:
        | "invalid_request"
        | "authentication_failed"
        | "temporarily_unavailable"
        | "storage_unavailable";
      retryable: boolean;
    };

export interface SessionServiceDependencies {
  callApps?: typeof callAppsScript;
  nowMs?: number;
}

interface ValidatedAppsSession {
  cleanerSubject: string;
  cleanerDisplayName: string;
  currentShift: RelaySessionResponseData["currentShift"];
  ledgerHighWater: RelaySessionResponseData["ledgerHighWater"];
}

function failure(
  error: Exclude<SessionServiceResult, { ok: true }>["error"],
  retryable: boolean,
): SessionServiceResult {
  return { ok: false, error, retryable };
}

function validateRequest(input: SessionRequestInput): boolean {
  return (
    APPS_SESSION_PATTERN.test(input.appsSessionToken) &&
    DEVICE_ID_PATTERN.test(input.deviceId)
  );
}

function sanitizeCurrentShift(value: unknown): ValidatedAppsSession["currentShift"] | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  const shift = value as Record<string, unknown>;
  if (shift.open === false) {
    return { open: false };
  }
  if (
    shift.open === true &&
    typeof shift.property === "string" &&
    shift.property.length > 0 &&
    shift.property.length <= 500 &&
    Number.isSafeInteger(shift.clockInMs) &&
    Number(shift.clockInMs) > 0
  ) {
    return {
      open: true,
      property: shift.property,
      clockInMs: Number(shift.clockInMs),
    };
  }
  return null;
}

function parseValidatedAppsSession(
  outcome: AppsCallOutcome,
  deviceId: string,
  nowMs: number,
): ValidatedAppsSession | SessionServiceResult {
  if (outcome.kind === "failure") {
    return failure("temporarily_unavailable", true);
  }
  const response = outcome.response;
  if (!response.ok || response.result !== "applied") {
    return response.result === "authentication_failed"
      ? failure("authentication_failed", false)
      : failure("temporarily_unavailable", response.retryable);
  }
  if (
    response.operation !== "validate_session" ||
    response.data === null ||
    Array.isArray(response.data) ||
    typeof response.data !== "object"
  ) {
    return failure("temporarily_unavailable", true);
  }

  const data = response.data as Record<string, unknown>;
  const cleanerSubject = data.cleanerSubject;
  const cleanerDisplayName = data.cleanerDisplayName;
  const appsSessionExpiresAtMs = data.appsSessionExpiresAtMs;
  const currentShift = sanitizeCurrentShift(data.currentShift);
  const highWater = data.ledgerHighWater;
  if (
    typeof cleanerSubject !== "string" ||
    !CLEANER_SUBJECT_PATTERN.test(cleanerSubject) ||
    typeof cleanerDisplayName !== "string" ||
    cleanerDisplayName.length === 0 ||
    !Number.isSafeInteger(appsSessionExpiresAtMs) ||
    Number(appsSessionExpiresAtMs) <= nowMs ||
    currentShift === null ||
    highWater === null ||
    Array.isArray(highWater) ||
    typeof highWater !== "object"
  ) {
    return failure("authentication_failed", false);
  }
  const ledger = highWater as Record<string, unknown>;
  if (
    ledger.deviceId !== deviceId ||
    !Number.isSafeInteger(ledger.appliedThroughSequence) ||
    Number(ledger.appliedThroughSequence) < 0
  ) {
    return failure("authentication_failed", false);
  }

  return {
    cleanerSubject,
    cleanerDisplayName,
    currentShift,
    ledgerHighWater: {
      deviceId,
      appliedThroughSequence: Number(ledger.appliedThroughSequence),
    },
  };
}

async function validateAppsSession(
  config: RelayConfig,
  input: SessionRequestInput,
  nowMs: number,
  callApps: typeof callAppsScript,
): Promise<ValidatedAppsSession | SessionServiceResult> {
  const outcome = await callApps(
    config,
    "validate_session",
    { sessionToken: input.appsSessionToken, deviceId: input.deviceId },
    { nowMs },
  );
  return parseValidatedAppsSession(outcome, input.deviceId, nowMs);
}

function successData(
  relayToken: string,
  input: SessionRequestInput,
  validated: ValidatedAppsSession,
  nowMs: number,
): RelaySessionResponseData {
  return {
    relayToken,
    expiresAtMs: nowMs + RELAY_TOKEN_LIFETIME_MS,
    cleanerSubject: validated.cleanerSubject,
    cleanerDisplayName: validated.cleanerDisplayName,
    deviceId: input.deviceId,
    currentShift: validated.currentShift,
    ledgerHighWater: validated.ledgerHighWater,
  };
}

export async function enrollRelaySession(
  db: D1Database,
  config: RelayConfig,
  input: SessionRequestInput,
  dependencies: SessionServiceDependencies = {},
): Promise<SessionServiceResult> {
  if (!validateRequest(input)) {
    return failure("invalid_request", false);
  }
  const nowMs = dependencies.nowMs ?? Date.now();
  const validated = await validateAppsSession(
    config,
    input,
    nowMs,
    dependencies.callApps ?? callAppsScript,
  );
  if ("ok" in validated) {
    return validated;
  }

  const relayToken = generateSecureId("relay", 32);
  const tokenHash = await hashRelayToken(
    relayToken,
    config.relayTokenHmacKey,
    config.environment,
  );
  try {
    await createSession(db, {
      sessionId: generateSecureId("session"),
      cleanerSubject: validated.cleanerSubject,
      deviceId: input.deviceId,
      tokenHash,
      nowMs,
    });
  } catch (_) {
    return failure("storage_unavailable", true);
  }
  return { ok: true, data: successData(relayToken, input, validated, nowMs) };
}

export async function renewRelaySession(
  db: D1Database,
  config: RelayConfig,
  bearerToken: string,
  input: SessionRequestInput,
  dependencies: SessionServiceDependencies = {},
): Promise<SessionServiceResult> {
  if (!validateRequest(input) || !/^relay_[A-Za-z0-9_-]{43}$/u.test(bearerToken)) {
    return failure("invalid_request", false);
  }
  const nowMs = dependencies.nowMs ?? Date.now();
  let currentSession;
  try {
    const currentHash = await hashRelayToken(
      bearerToken,
      config.relayTokenHmacKey,
      config.environment,
    );
    currentSession = await findActiveSessionByTokenHash(db, currentHash, nowMs);
  } catch (_) {
    return failure("storage_unavailable", true);
  }
  if (currentSession === null || currentSession.device_id !== input.deviceId) {
    return failure("authentication_failed", false);
  }

  const validated = await validateAppsSession(
    config,
    input,
    nowMs,
    dependencies.callApps ?? callAppsScript,
  );
  if ("ok" in validated) {
    return validated;
  }
  if (validated.cleanerSubject !== currentSession.cleaner_subject) {
    return failure("authentication_failed", false);
  }

  const relayToken = generateSecureId("relay", 32);
  const tokenHash = await hashRelayToken(
    relayToken,
    config.relayTokenHmacKey,
    config.environment,
  );
  try {
    if (
      !(await rotateSessionToken(
        db,
        currentSession.session_id,
        tokenHash,
        nowMs,
      ))
    ) {
      return failure("authentication_failed", false);
    }
  } catch (_) {
    return failure("storage_unavailable", true);
  }
  return { ok: true, data: successData(relayToken, input, validated, nowMs) };
}
/* end[relay_session_service] */

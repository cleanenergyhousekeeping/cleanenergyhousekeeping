import {
  bytesToBase64Url,
  generateSecureId,
  signBytes,
} from "./crypto";
import type { RelayConfig } from "./config";
import type { InfrastructureFailureCategory } from "./persistence/types";

/* begin[relay_apps_script_client] */
export const APPS_SCRIPT_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1_000;

export type AppsOperation = "validate_session" | "submit_event";

export interface AppsRelayResponse {
  ok: boolean;
  operation: string;
  result: string;
  retryable: boolean;
  data?: unknown;
}

export interface AppsSignedEnvelope {
  mode: "relayWorkerRequest";
  keyId: string;
  signedBody: string;
  signature: string;
}

export type AppsCallOutcome =
  | { kind: "result"; response: AppsRelayResponse }
  | {
      kind: "failure";
      category: InfrastructureFailureCategory;
      retryAfterMs?: number;
    };

export interface AppsCallOptions {
  nowMs?: number;
  nonce?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isAppsRelayResponse(value: unknown): value is AppsRelayResponse {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.operation === "string" &&
    typeof candidate.result === "string" &&
    typeof candidate.retryable === "boolean"
  );
}

function parseRetryAfterMs(value: string | null, nowMs: number): number | undefined {
  if (value === null) {
    return undefined;
  }
  const seconds = Number(value);
  const delayMs = Number.isFinite(seconds)
    ? Math.round(seconds * 1_000)
    : Date.parse(value) - nowMs;
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > MAX_RETRY_AFTER_MS) {
    return undefined;
  }
  return delayMs;
}

export async function buildAppsSignedEnvelope(
  config: RelayConfig,
  operation: AppsOperation,
  payload: Record<string, unknown>,
  nowMs: number,
  nonce: string,
): Promise<AppsSignedEnvelope> {
  const signingKey = config.appsHmacKeys.get(config.appsActiveKeyId);
  if (signingKey === undefined) {
    throw new Error("Active Apps signing key is unavailable");
  }
  const signedRequest = {
    version: 1,
    keyId: config.appsActiveKeyId,
    environment: config.environment,
    audience: config.appsAudience,
    operation,
    timestampMs: nowMs,
    nonce,
    payload,
  };
  const signedBytes = new TextEncoder().encode(JSON.stringify(signedRequest));
  return {
    mode: "relayWorkerRequest",
    keyId: config.appsActiveKeyId,
    signedBody: bytesToBase64Url(signedBytes),
    signature: await signBytes(signedBytes, signingKey),
  };
}

export async function callAppsScript(
  config: RelayConfig,
  operation: AppsOperation,
  payload: Record<string, unknown>,
  options: AppsCallOptions = {},
): Promise<AppsCallOutcome> {
  const nowMs = options.nowMs ?? Date.now();
  let envelope: AppsSignedEnvelope;
  try {
    envelope = await buildAppsSignedEnvelope(
      config,
      operation,
      payload,
      nowMs,
      options.nonce ?? generateSecureId("nonce"),
    );
  } catch (_) {
    return { kind: "failure", category: "apps_script_protocol_error" };
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(config.appsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs ?? APPS_SCRIPT_TIMEOUT_MS),
    });

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("Retry-After"),
        nowMs,
      );
      return retryAfterMs === undefined
        ? { kind: "failure", category: "rate_limited" }
        : { kind: "failure", category: "rate_limited", retryAfterMs };
    }
    if (response.status >= 500) {
      return { kind: "failure", category: "upstream_5xx" };
    }
    if (!response.ok) {
      return { kind: "failure", category: "apps_script_protocol_error" };
    }

    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      return { kind: "failure", category: "apps_script_protocol_error" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (_) {
      return { kind: "failure", category: "apps_script_protocol_error" };
    }
    if (!isAppsRelayResponse(parsed)) {
      return { kind: "failure", category: "apps_script_protocol_error" };
    }
    return { kind: "result", response: parsed };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "";
    return {
      kind: "failure",
      category:
        errorName === "AbortError" || errorName === "TimeoutError"
          ? "timeout"
          : "network_error",
    };
  }
}
/* end[relay_apps_script_client] */

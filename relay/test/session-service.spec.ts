import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AppsCallOutcome } from "../src/apps-script-client";
import type { RelayConfig } from "../src/config";
import {
  encryptJson,
  eventEncryptionContext,
  hashRelayToken,
  importEncryptionKey,
  importHmacKey,
} from "../src/crypto";
import { ensureLane, getEvent, insertEvent } from "../src/persistence/events";
import {
  findActiveSessionByTokenHash,
  RELAY_TOKEN_LIFETIME_MS,
  RELAY_TOKEN_ROTATION_OVERLAP_MS,
} from "../src/persistence/sessions";
import {
  enrollRelaySession,
  renewRelaySession,
} from "../src/session-service";

/* begin[relay_session_service_tests] */
const NOW_MS = Date.UTC(2026, 7, 15, 20, 0, 0);
const SUBJECT_A = `cehusr_v1_${"A".repeat(43)}`;
const SUBJECT_B = `cehusr_v1_${"B".repeat(43)}`;
const DEVICE_A = "device_session_0001";
const DEVICE_B = "device_session_0002";
const APPS_TOKEN = "apps_session_123456789";

async function makeConfig(): Promise<RelayConfig> {
  const encryptionKey = await importEncryptionKey(new Uint8Array(32).fill(9));
  return {
    environment: "test",
    appsAudience: "ceh-relay:test:apps-script",
    appsUrl: "https://script.google.test/macros/s/synthetic/exec",
    appsActiveKeyId: "test-v1",
    appsHmacKeys: new Map([["test-v1", await importHmacKey("apps-key")]]),
    relayTokenHmacKey: await importHmacKey("relay-token-key"),
    eventDigestHmacKey: await importHmacKey("event-digest-key"),
    payloadEncryptionKeys: new Map([[1, encryptionKey]]),
    payloadActiveKeyVersion: 1,
  };
}

function successfulValidation(
  cleanerSubject = SUBJECT_A,
): (
  ...args: Parameters<typeof import("../src/apps-script-client").callAppsScript>
) => Promise<AppsCallOutcome> {
  return async (_config, _operation, payload) => ({
    kind: "result",
    response: {
      ok: true,
      operation: "validate_session",
      result: "applied",
      retryable: false,
      data: {
        cleanerSubject,
        cleanerDisplayName: "Synthetic Cleaner",
        appsSessionExpiresAtMs: NOW_MS + RELAY_TOKEN_LIFETIME_MS,
        currentShift: { open: true, property: "Synthetic Property", clockInMs: NOW_MS },
        ledgerHighWater: {
          deviceId: payload.deviceId,
          appliedThroughSequence: 2,
        },
      },
    },
  });
}

describe("relay session enrollment and renewal", () => {
  it("validates Apps first and creates a seven-day hashed-token session", async () => {
    const config = await makeConfig();
    const result = await enrollRelaySession(
      env.DB,
      config,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_A },
      { nowMs: NOW_MS, callApps: successfulValidation() },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.expiresAtMs).toBe(NOW_MS + RELAY_TOKEN_LIFETIME_MS);
    expect(result.data.currentShift).toEqual({
      open: true,
      property: "Synthetic Property",
      clockInMs: NOW_MS,
    });
    const tokenHash = await hashRelayToken(
      result.data.relayToken,
      config.relayTokenHmacKey,
      "test",
    );
    expect(
      await findActiveSessionByTokenHash(env.DB, tokenHash, NOW_MS + 1),
    ).toMatchObject({ cleaner_subject: SUBJECT_A, device_id: DEVICE_A });
    expect(JSON.stringify(await env.DB.prepare("SELECT * FROM relay_sessions").all())).not.toContain(
      APPS_TOKEN,
    );
  });

  it("keeps the current session usable when Apps validation fails", async () => {
    const config = await makeConfig();
    const first = await enrollRelaySession(
      env.DB,
      config,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_A },
      { nowMs: NOW_MS, callApps: successfulValidation() },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const rejected = await enrollRelaySession(
      env.DB,
      config,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_B },
      {
        nowMs: NOW_MS + 1,
        callApps: async () => ({
          kind: "result",
          response: {
            ok: false,
            operation: "validate_session",
            result: "authentication_failed",
            retryable: false,
          },
        }),
      },
    );
    const originalHash = await hashRelayToken(
      first.data.relayToken,
      config.relayTokenHmacKey,
      "test",
    );

    expect(rejected).toEqual({
      ok: false,
      error: "authentication_failed",
      retryable: false,
    });
    expect(
      await findActiveSessionByTokenHash(env.DB, originalHash, NOW_MS + 2),
    ).not.toBeNull();
  });

  it("rejects an explicitly expired Apps session without creating D1 state", async () => {
    const config = await makeConfig();
    const countBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM relay_sessions",
    ).first<number>("count");
    const result = await enrollRelaySession(
      env.DB,
      config,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_A },
      {
        nowMs: NOW_MS,
        callApps: async (_config, _operation, payload) => ({
          kind: "result",
          response: {
            ok: true,
            operation: "validate_session",
            result: "applied",
            retryable: false,
            data: {
              cleanerSubject: SUBJECT_A,
              cleanerDisplayName: "Synthetic Cleaner",
              appsSessionExpiresAtMs: NOW_MS,
              currentShift: { open: false },
              ledgerHighWater: {
                deviceId: payload.deviceId,
                appliedThroughSequence: 0,
              },
            },
          },
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      error: "authentication_failed",
      retryable: false,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM relay_sessions").first<number>(
        "count",
      ),
    ).toBe(countBefore);
  });

  it("rotates only when bearer, validated subject, and device all agree", async () => {
    const config = await makeConfig();
    const enrolled = await enrollRelaySession(
      env.DB,
      config,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_A },
      { nowMs: NOW_MS, callApps: successfulValidation() },
    );
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;

    const mismatch = await renewRelaySession(
      env.DB,
      config,
      enrolled.data.relayToken,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_A },
      { nowMs: NOW_MS + 1_000, callApps: successfulValidation(SUBJECT_B) },
    );
    expect(mismatch).toEqual({
      ok: false,
      error: "authentication_failed",
      retryable: false,
    });

    const renewed = await renewRelaySession(
      env.DB,
      config,
      enrolled.data.relayToken,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_A },
      { nowMs: NOW_MS + 2_000, callApps: successfulValidation() },
    );
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    const oldHash = await hashRelayToken(
      enrolled.data.relayToken,
      config.relayTokenHmacKey,
      "test",
    );
    const newHash = await hashRelayToken(
      renewed.data.relayToken,
      config.relayTokenHmacKey,
      "test",
    );
    expect(
      await findActiveSessionByTokenHash(
        env.DB,
        oldHash,
        NOW_MS + 2_000 + RELAY_TOKEN_ROTATION_OVERLAP_MS - 1,
      ),
    ).not.toBeNull();
    expect(
      await findActiveSessionByTokenHash(
        env.DB,
        oldHash,
        NOW_MS + 2_000 + RELAY_TOKEN_ROTATION_OVERLAP_MS,
      ),
    ).toBeNull();
    expect(
      await findActiveSessionByTokenHash(
        env.DB,
        newHash,
        NOW_MS + 2_000 + RELAY_TOKEN_ROTATION_OVERLAP_MS,
      ),
    ).not.toBeNull();
  });

  it("reenrolls the same device without altering its lane or queued event", async () => {
    const config = await makeConfig();
    const lane = await ensureLane(env.DB, {
      laneId: "lane_session_recovery",
      cleanerSubject: SUBJECT_A,
      deviceId: DEVICE_A,
      nowMs: NOW_MS,
    });
    const encryptedPayload = await encryptJson(
      { synthetic: true },
      config.payloadEncryptionKeys.get(1)!,
      1,
      eventEncryptionContext("test", "event_session_recovery"),
    );
    await insertEvent(env.DB, {
      eventId: "event_session_recovery",
      laneId: lane.lane_id,
      deviceSequence: 1,
      eventType: "clock_in",
      submittedAtMs: NOW_MS,
      payloadDigest: "A".repeat(43),
      encryptedPayload,
      acceptedAtMs: NOW_MS,
    });

    const first = await enrollRelaySession(
      env.DB,
      config,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_A },
      { nowMs: NOW_MS, callApps: successfulValidation() },
    );
    const recovered = await enrollRelaySession(
      env.DB,
      config,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_A },
      { nowMs: NOW_MS + 1, callApps: successfulValidation() },
    );

    expect(first.ok).toBe(true);
    expect(recovered.ok).toBe(true);
    expect(await getEvent(env.DB, "event_session_recovery")).toMatchObject({
      lane_id: lane.lane_id,
      state: "accepted",
    });
  });

  it("atomically revokes the prior device without deleting accepted events", async () => {
    const config = await makeConfig();
    const first = await enrollRelaySession(
      env.DB,
      config,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_A },
      { nowMs: NOW_MS, callApps: successfulValidation() },
    );
    const second = await enrollRelaySession(
      env.DB,
      config,
      { appsSessionToken: APPS_TOKEN, deviceId: DEVICE_B },
      { nowMs: NOW_MS + 1, callApps: successfulValidation() },
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const firstHash = await hashRelayToken(
      first.data.relayToken,
      config.relayTokenHmacKey,
      "test",
    );
    const secondHash = await hashRelayToken(
      second.data.relayToken,
      config.relayTokenHmacKey,
      "test",
    );
    expect(await findActiveSessionByTokenHash(env.DB, firstHash, NOW_MS + 2)).toBeNull();
    expect(await findActiveSessionByTokenHash(env.DB, secondHash, NOW_MS + 2)).not.toBeNull();
  });
});
/* end[relay_session_service_tests] */

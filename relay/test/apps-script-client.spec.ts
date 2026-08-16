import { describe, expect, it } from "vitest";

import {
  buildAppsSignedEnvelope,
  callAppsScript,
} from "../src/apps-script-client";
import { loadRelayConfig, type RelayConfig } from "../src/config";
import {
  base64UrlToBytes,
  importEncryptionKey,
  importHmacKey,
} from "../src/crypto";

/* begin[relay_apps_script_client_tests] */
const NOW_MS = Date.UTC(2026, 7, 15, 20, 0, 0);

async function makeConfig(environment: "test" | "production" = "test") {
  const activeKey = await importHmacKey("synthetic-active-apps-key");
  const priorKey = await importHmacKey("synthetic-prior-apps-key");
  const encryptionKey = await importEncryptionKey(new Uint8Array(32).fill(7));
  return {
    environment,
    appsAudience: `ceh-relay:${environment}:apps-script`,
    appsUrl: "https://script.google.test/macros/s/synthetic/exec",
    appsActiveKeyId: `${environment}-v2`,
    appsHmacKeys: new Map([
      [`${environment}-v1`, priorKey],
      [`${environment}-v2`, activeKey],
    ]),
    relayTokenHmacKey: await importHmacKey("synthetic-token-key"),
    eventDigestHmacKey: await importHmacKey("synthetic-digest-key"),
    payloadEncryptionKeys: new Map([[1, encryptionKey]]),
    payloadActiveKeyVersion: 1,
  } satisfies RelayConfig;
}

describe("Apps Script signed client", () => {
  it("loads an overlapping key ring and fails closed when active IDs are missing", async () => {
    const encodedKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    const bindings = {
      CEH_RELAY_ENVIRONMENT: "test",
      CEH_RELAY_APPS_ACTIVE_KEY_ID: "test-v2",
      CEH_RELAY_PAYLOAD_ACTIVE_KEY_VERSION: "1",
      CEH_RELAY_APPS_URL: "https://script.google.test/macros/s/synthetic/exec",
      CEH_RELAY_APPS_HMAC_KEYS_JSON: JSON.stringify({
        "test-v1": encodedKey,
        "test-v2": encodedKey,
      }),
      CEH_RELAY_TOKEN_HMAC_KEY: encodedKey,
      CEH_RELAY_EVENT_DIGEST_HMAC_KEY: encodedKey,
      CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON: JSON.stringify({ 1: encodedKey }),
    } as unknown as Env;
    const loaded = await loadRelayConfig(bindings);

    expect([...loaded.appsHmacKeys.keys()]).toEqual(["test-v1", "test-v2"]);
    await expect(
      loadRelayConfig({
        ...bindings,
        CEH_RELAY_APPS_ACTIVE_KEY_ID: "test-missing",
      } as unknown as Env),
    ).rejects.toThrow("Relay configuration is unavailable");
  });

  it("signs the exact UTF-8 JSON bytes with the active versioned key", async () => {
    const config = await makeConfig();
    const envelope = await buildAppsSignedEnvelope(
      config,
      "validate_session",
      { sessionToken: "session_123456789", deviceId: "device_123456789" },
      NOW_MS,
      "nonce_1234567890123456789012",
    );
    const signedBytes = base64UrlToBytes(envelope.signedBody);
    const signedJson = new TextDecoder().decode(signedBytes);
    const expectedSignedJson = JSON.stringify({
      version: 1,
      keyId: "test-v2",
      environment: "test",
      audience: "ceh-relay:test:apps-script",
      operation: "validate_session",
      timestampMs: NOW_MS,
      nonce: "nonce_1234567890123456789012",
      payload: {
        sessionToken: "session_123456789",
        deviceId: "device_123456789",
      },
    });

    expect(signedJson).toBe(expectedSignedJson);
    expect(JSON.parse(signedJson)).toEqual({
      version: 1,
      keyId: "test-v2",
      environment: "test",
      audience: "ceh-relay:test:apps-script",
      operation: "validate_session",
      timestampMs: NOW_MS,
      nonce: "nonce_1234567890123456789012",
      payload: {
        sessionToken: "session_123456789",
        deviceId: "device_123456789",
      },
    });
    expect(
      await crypto.subtle.verify(
        "HMAC",
        config.appsHmacKeys.get("test-v2")!,
        base64UrlToBytes(envelope.signature),
        signedBytes,
      ),
    ).toBe(true);
    expect(
      await crypto.subtle.verify(
        "HMAC",
        config.appsHmacKeys.get("test-v1")!,
        base64UrlToBytes(envelope.signature),
        signedBytes,
      ),
    ).toBe(false);
  });

  it("cryptographically separates test and production envelopes", async () => {
    const payload = { eventId: "event_123456789012" };
    const testEnvelope = await buildAppsSignedEnvelope(
      await makeConfig("test"),
      "submit_event",
      payload,
      NOW_MS,
      "nonce_1234567890123456789012",
    );
    const productionEnvelope = await buildAppsSignedEnvelope(
      await makeConfig("production"),
      "submit_event",
      payload,
      NOW_MS,
      "nonce_1234567890123456789012",
    );

    expect(testEnvelope.signedBody).not.toBe(productionEnvelope.signedBody);
    expect(testEnvelope.signature).not.toBe(productionEnvelope.signature);
  });

  it("uses fresh signed request material while retaining stable event identity", async () => {
    const config = await makeConfig();
    const bodies: string[] = [];
    const payload = {
      eventId: "event_stable_12345",
      payloadDigest: "A".repeat(43),
    };
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return Response.json({
        ok: false,
        operation: "submit_event",
        result: "lock_busy",
        retryable: true,
      });
    };

    await callAppsScript(config, "submit_event", payload, {
      nowMs: NOW_MS,
      nonce: "nonce_1234567890123456789012",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await callAppsScript(config, "submit_event", payload, {
      nowMs: NOW_MS + 1,
      nonce: "nonce_2234567890123456789012",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const envelopes = bodies.map((body) => JSON.parse(body) as { signedBody: string; signature: string });
    const requests = envelopes.map((envelope) =>
      JSON.parse(new TextDecoder().decode(base64UrlToBytes(envelope.signedBody))),
    );
    expect(envelopes[0]).not.toEqual(envelopes[1]);
    expect(requests[0].payload).toEqual(requests[1].payload);
    expect(requests[0].nonce).not.toBe(requests[1].nonce);
  });

  it("honors only bounded Retry-After values and stores no response body", async () => {
    const config = await makeConfig();
    const bounded = await callAppsScript(config, "submit_event", {}, {
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response("raw provider detail", {
          status: 429,
          headers: { "Retry-After": "7200" },
        })) as typeof fetch,
    });
    const excessive = await callAppsScript(config, "submit_event", {}, {
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response("raw provider detail", {
          status: 429,
          headers: { "Retry-After": "172800" },
        })) as typeof fetch,
    });

    expect(bounded).toEqual({
      kind: "failure",
      category: "rate_limited",
      retryAfterMs: 7_200_000,
    });
    expect(excessive).toEqual({ kind: "failure", category: "rate_limited" });
    expect(JSON.stringify([bounded, excessive])).not.toContain("provider detail");
  });

  it("sanitizes timeouts, network failures, and upstream errors", async () => {
    const config = await makeConfig();
    const timeout = await callAppsScript(config, "submit_event", {}, {
      fetchImpl: (async () => {
        throw new DOMException("raw timeout detail", "TimeoutError");
      }) as typeof fetch,
    });
    const network = await callAppsScript(config, "submit_event", {}, {
      fetchImpl: (async () => {
        throw new Error("raw network detail");
      }) as typeof fetch,
    });
    const upstream = await callAppsScript(config, "submit_event", {}, {
      fetchImpl: (async () =>
        new Response("raw upstream detail", { status: 503 })) as typeof fetch,
    });

    expect(timeout).toEqual({ kind: "failure", category: "timeout" });
    expect(network).toEqual({ kind: "failure", category: "network_error" });
    expect(upstream).toEqual({ kind: "failure", category: "upstream_5xx" });
    expect(JSON.stringify([timeout, network, upstream])).not.toContain("raw");
  });
});
/* end[relay_apps_script_client_tests] */

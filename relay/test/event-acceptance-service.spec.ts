import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RelayConfig } from "../src/config";
import {
  acceptRelayEvent,
  EVENT_REQUEST_MAX_BYTES,
  parseRelayEventRequest,
  type RelayEventRequestInput,
} from "../src/event-acceptance-service";
import {
  decryptJson,
  digestCanonicalEvent,
  eventEncryptionContext,
  generateSecureId,
  hashRelayToken,
  importEncryptionKey,
  importHmacKey,
} from "../src/crypto";
import {
  createSession,
  RELAY_TOKEN_LIFETIME_MS,
  RELAY_TOKEN_ROTATION_OVERLAP_MS,
  revokeSession,
  rotateSessionToken,
} from "../src/persistence/sessions";
import type { RelayEventRow, RelayLaneRow } from "../src/persistence/types";

/* begin[relay_event_acceptance_service_tests] */
const NOW_MS = Date.UTC(2026, 7, 16, 20, 0, 0);
const SUBJECT = `cehusr_v1_${"A".repeat(43)}`;
const DEVICE = "device_acceptance_0001";

async function makeConfig(): Promise<RelayConfig> {
  return {
    environment: "test",
    appsAudience: "ceh-relay:test:apps-script",
    appsUrl: "https://script.google.test/macros/s/synthetic/exec",
    appsActiveKeyId: "test-v1",
    appsHmacKeys: new Map([["test-v1", await importHmacKey("apps-key")]]),
    relayTokenHmacKey: await importHmacKey("relay-token-key"),
    eventDigestHmacKey: await importHmacKey("event-digest-key"),
    payloadEncryptionKeys: new Map([
      [1, await importEncryptionKey(new Uint8Array(32).fill(7))],
    ]),
    payloadActiveKeyVersion: 1,
  };
}

function validInput(
  label: string,
  overrides: Partial<RelayEventRequestInput> = {},
): RelayEventRequestInput {
  return {
    eventId: `event_acceptance_${label}`,
    deviceSequence: 1,
    eventType: "clock_in",
    submittedAtMs: NOW_MS - 60_000,
    property: "Synthetic Property",
    note: "Synthetic note",
    ...overrides,
  };
}

async function createAuthorizedSession(
  config: RelayConfig,
  options: {
    token?: string;
    subject?: string;
    device?: string;
    nowMs?: number;
  } = {},
): Promise<{ token: string; sessionId: string }> {
  const token = options.token ?? generateSecureId("relay", 32);
  const nowMs = options.nowMs ?? NOW_MS;
  const session = await createSession(env.DB, {
    sessionId: generateSecureId("session"),
    cleanerSubject: options.subject ?? SUBJECT,
    deviceId: options.device ?? DEVICE,
    tokenHash: await hashRelayToken(
      token,
      config.relayTokenHmacKey,
      config.environment,
    ),
    nowMs,
  });
  return { token, sessionId: session.session_id };
}

async function relayCounts(): Promise<{ lanes: number; events: number }> {
  const [lanes, events] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM relay_lanes").first<number>(
      "count",
    ),
    env.DB.prepare("SELECT COUNT(*) AS count FROM relay_events").first<number>(
      "count",
    ),
  ]);
  return { lanes: lanes ?? 0, events: events ?? 0 };
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM relay_events"),
    env.DB.prepare("DELETE FROM relay_lanes"),
    env.DB.prepare("DELETE FROM relay_session_tokens"),
    env.DB.prepare("DELETE FROM relay_sessions"),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticated event acceptance", () => {
  it("stores exactly one authenticated, encrypted canonical event without Apps delivery", async () => {
    const config = await makeConfig();
    const { token } = await createAuthorizedSession(config);
    const input = validInput("success");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await acceptRelayEvent(env.DB, config, token, input, {
      nowMs: NOW_MS,
    });

    expect(result).toEqual({
      ok: true,
      outcome: "inserted",
      eventId: input.eventId,
    });
    expect(await relayCounts()).toEqual({ lanes: 1, events: 1 });
    const lane = await env.DB.prepare("SELECT * FROM relay_lanes")
      .first<RelayLaneRow>();
    const event = await env.DB.prepare("SELECT * FROM relay_events")
      .first<RelayEventRow>();
    expect(lane).toMatchObject({ cleaner_subject: SUBJECT, device_id: DEVICE });
    expect(event).not.toBeNull();
    if (event === null) return;
    expect(event).toMatchObject({
      event_id: input.eventId,
      device_sequence: input.deviceSequence,
      event_type: input.eventType,
      submitted_at_ms: input.submittedAtMs,
      state: "accepted",
    });
    const canonicalEvent = {
      eventId: input.eventId,
      cleanerSubject: SUBJECT,
      deviceId: DEVICE,
      deviceSequence: input.deviceSequence,
      eventType: input.eventType,
      submittedAtMs: input.submittedAtMs,
      property: input.property,
      note: input.note,
    };
    await expect(
      decryptJson(
        {
          ciphertext: event.payload_ciphertext!,
          nonce: event.payload_nonce!,
          keyVersion: event.encryption_key_version!,
        },
        config.payloadEncryptionKeys,
        eventEncryptionContext("test", input.eventId),
      ),
    ).resolves.toEqual(canonicalEvent);
    expect(event.payload_digest).toBe(
      await digestCanonicalEvent(canonicalEvent, config.eventDigestHmacKey, "test"),
    );
    const storedRows = JSON.stringify({ lane, event });
    expect(storedRows).not.toContain(input.property);
    expect(storedRows).not.toContain(input.note);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts every event type and the exact property and note boundaries", async () => {
    const config = await makeConfig();
    const { token } = await createAuthorizedSession(config);
    const inputs = [
      validInput("clock-in-boundary", {
        deviceSequence: 1,
        eventType: "clock_in",
        property: "p".repeat(500),
        note: "",
      }),
      validInput("add-note-boundary", {
        deviceSequence: 2,
        eventType: "add_note",
        note: "\u{1F642}".repeat(1_000),
      }),
      validInput("clock-out-boundary", {
        deviceSequence: 3,
        eventType: "clock_out",
        note: "",
      }),
    ];

    for (const input of inputs) {
      expect(
        await acceptRelayEvent(env.DB, config, token, input, { nowMs: NOW_MS }),
      ).toMatchObject({ ok: true, outcome: "inserted", eventId: input.eventId });
    }
    expect(await relayCounts()).toEqual({ lanes: 1, events: 3 });
  });

  it("rejects malformed fields, boundary overruns, and additional identity fields", async () => {
    const config = await makeConfig();
    const { token } = await createAuthorizedSession(config);
    const cases: unknown[] = [
      {},
      { ...validInput("extra"), cleanerSubject: SUBJECT },
      { ...validInput("bad-id"), eventId: "short" },
      { ...validInput("bad-sequence"), deviceSequence: 0 },
      { ...validInput("bad-sequence-type"), deviceSequence: "1" },
      { ...validInput("bad-type"), eventType: "delete" },
      { ...validInput("bad-time"), submittedAtMs: 0 },
      { ...validInput("bad-time-type"), submittedAtMs: "1" },
      { ...validInput("empty-property"), property: "" },
      { ...validInput("long-property"), property: "p".repeat(501) },
      { ...validInput("long-note"), note: "\u{1F642}".repeat(1_001) },
      { ...validInput("empty-add-note"), eventType: "add_note", note: "   " },
    ];

    for (const input of cases) {
      expect(
        await acceptRelayEvent(env.DB, config, token, input, { nowMs: NOW_MS }),
      ).toEqual({ ok: false, error: "invalid_request", retryable: false });
    }
    expect(await relayCounts()).toEqual({ lanes: 0, events: 0 });
  });

  it("rejects a whitespace-only property without creating a lane or event", async () => {
    const config = await makeConfig();
    const { token } = await createAuthorizedSession(config);

    expect(
      await acceptRelayEvent(
        env.DB,
        config,
        token,
        validInput("whitespace-property", { property: " " }),
        { nowMs: NOW_MS },
      ),
    ).toEqual({ ok: false, error: "invalid_request", retryable: false });
    expect(await relayCounts()).toEqual({ lanes: 0, events: 0 });
  });

  it("fails closed for malformed, unknown, revoked, and expired bearer tokens", async () => {
    const config = await makeConfig();
    const revoked = await createAuthorizedSession(config);
    await revokeSession(env.DB, revoked.sessionId, NOW_MS + 1);
    const expired = await createAuthorizedSession(config, {
      subject: `cehusr_v1_${"B".repeat(43)}`,
      device: "device_acceptance_0002",
      nowMs: NOW_MS - RELAY_TOKEN_LIFETIME_MS - 1,
    });
    const tokens = [
      "malformed",
      generateSecureId("relay", 32),
      revoked.token,
      expired.token,
    ];

    for (const [index, token] of tokens.entries()) {
      expect(
        await acceptRelayEvent(
          env.DB,
          config,
          token,
          validInput(`auth-${index}`),
          { nowMs: NOW_MS + 2 },
        ),
      ).toEqual({
        ok: false,
        error: "authentication_failed",
        retryable: false,
      });
    }
    expect(await relayCounts()).toEqual({ lanes: 0, events: 0 });
  });

  it("honors the existing rotated-token overlap window", async () => {
    const config = await makeConfig();
    const oldSession = await createAuthorizedSession(config);
    const nextToken = generateSecureId("relay", 32);
    const rotationTime = NOW_MS + 1_000;
    expect(
      await rotateSessionToken(
        env.DB,
        oldSession.sessionId,
        await hashRelayToken(
          nextToken,
          config.relayTokenHmacKey,
          config.environment,
        ),
        rotationTime,
      ),
    ).toBe(true);

    expect(
      await acceptRelayEvent(
        env.DB,
        config,
        oldSession.token,
        validInput("overlap-old", { deviceSequence: 1 }),
        { nowMs: rotationTime + RELAY_TOKEN_ROTATION_OVERLAP_MS - 1 },
      ),
    ).toMatchObject({ ok: true, outcome: "inserted" });
    expect(
      await acceptRelayEvent(
        env.DB,
        config,
        oldSession.token,
        validInput("overlap-expired", { deviceSequence: 2 }),
        { nowMs: rotationTime + RELAY_TOKEN_ROTATION_OVERLAP_MS },
      ),
    ).toEqual({
      ok: false,
      error: "authentication_failed",
      retryable: false,
    });
    expect(
      await acceptRelayEvent(
        env.DB,
        config,
        nextToken,
        validInput("overlap-new", { deviceSequence: 2 }),
        { nowMs: rotationTime + RELAY_TOKEN_ROTATION_OVERLAP_MS },
      ),
    ).toMatchObject({ ok: true, outcome: "inserted" });
    expect(await relayCounts()).toEqual({ lanes: 1, events: 2 });
  });

  it("returns stable duplicate acknowledgments and sanitized conflicts", async () => {
    const config = await makeConfig();
    const { token } = await createAuthorizedSession(config);
    const input = validInput("idempotency");

    expect(
      await acceptRelayEvent(env.DB, config, token, input, { nowMs: NOW_MS }),
    ).toMatchObject({ ok: true, outcome: "inserted" });
    expect(
      await acceptRelayEvent(env.DB, config, token, input, { nowMs: NOW_MS + 1 }),
    ).toEqual({
      ok: true,
      outcome: "identical_duplicate",
      eventId: input.eventId,
    });
    expect(
      await acceptRelayEvent(
        env.DB,
        config,
        token,
        { ...input, note: "Altered" },
        { nowMs: NOW_MS + 2 },
      ),
    ).toEqual({ ok: false, error: "event_conflict", retryable: false });
    expect(
      await acceptRelayEvent(
        env.DB,
        config,
        token,
        validInput("sequence-conflict", { deviceSequence: 1 }),
        { nowMs: NOW_MS + 3 },
      ),
    ).toEqual({ ok: false, error: "event_conflict", retryable: false });
    expect(await relayCounts()).toEqual({ lanes: 1, events: 1 });
  });

  it("sanitizes missing encryption configuration and D1 failures", async () => {
    const config = await makeConfig();
    const { token } = await createAuthorizedSession(config);
    const missingKeyConfig = { ...config, payloadEncryptionKeys: new Map() };
    expect(
      await acceptRelayEvent(
        env.DB,
        missingKeyConfig,
        token,
        validInput("missing-key"),
        { nowMs: NOW_MS },
      ),
    ).toEqual({
      ok: false,
      error: "temporarily_unavailable",
      retryable: true,
    });

    const unavailableDb = {
      prepare(): never {
        throw new Error("raw sensitive D1 failure");
      },
    } as unknown as D1Database;
    const unavailable = await acceptRelayEvent(
      unavailableDb,
      config,
      token,
      validInput("d1-failure"),
      { nowMs: NOW_MS },
    );
    expect(unavailable).toEqual({
      ok: false,
      error: "temporarily_unavailable",
      retryable: true,
    });
    expect(JSON.stringify(unavailable)).not.toContain("raw sensitive");
    expect(await relayCounts()).toEqual({ lanes: 0, events: 0 });
  });
});

describe("event request parsing", () => {
  it("requires JSON and enforces both declared and actual byte limits", async () => {
    expect(
      await parseRelayEventRequest(
        new Request("https://relay.test/v1/relay-events", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "{}",
        }),
      ),
    ).toBeNull();
    expect(
      await parseRelayEventRequest(
        new Request("https://relay.test/v1/relay-events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(EVENT_REQUEST_MAX_BYTES + 1),
          },
          body: "{}",
        }),
      ),
    ).toBeNull();
    expect(
      await parseRelayEventRequest(
        new Request("https://relay.test/v1/relay-events", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ note: "x".repeat(EVENT_REQUEST_MAX_BYTES) }),
        }),
      ),
    ).toBeNull();
  });
});
/* end[relay_event_acceptance_service_tests] */

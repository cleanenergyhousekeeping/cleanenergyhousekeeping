import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AppsCallOutcome } from "../src/apps-script-client";
import type { RelayConfig } from "../src/config";
import {
  ATTENTION_REQUIRED_AGE_MS,
  runDeliveryBatch,
} from "../src/delivery-service";
import {
  digestCanonicalEvent,
  encryptJson,
  eventEncryptionContext,
  importEncryptionKey,
  importHmacKey,
} from "../src/crypto";
import {
  ensureLane,
  getEvent,
  insertEvent,
} from "../src/persistence/events";
import {
  createSession,
  findActiveSessionByTokenHash,
} from "../src/persistence/sessions";
import type { EventType, RelayLaneRow } from "../src/persistence/types";

/* begin[relay_delivery_service_tests] */
const NOW_MS = Date.UTC(2026, 7, 15, 20, 0, 0);

interface EventFixture {
  eventId: string;
  lane: RelayLaneRow;
  property: string;
  note: string;
}

async function makeConfig(): Promise<RelayConfig> {
  const encryptionKey = await importEncryptionKey(new Uint8Array(32).fill(11));
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

async function createFixture(
  label: string,
  config: RelayConfig,
  options: {
    lane?: RelayLaneRow;
    sequence?: number;
    eventType?: EventType;
    acceptedAtMs?: number;
    payloadOverrides?: Record<string, unknown>;
    digestOverride?: string;
  } = {},
): Promise<EventFixture> {
  const acceptedAtMs = options.acceptedAtMs ?? NOW_MS;
  const lane =
    options.lane ??
    (await ensureLane(env.DB, {
      laneId: `lane_delivery_${label}`,
      cleanerSubject: `cleaner_subject_delivery_${label}`,
      deviceId: `device_delivery_${label}`,
      nowMs: acceptedAtMs,
    }));
  const sequence = options.sequence ?? 1;
  const eventType = options.eventType ?? "clock_in";
  const eventId = `event_delivery_${label}`;
  const submittedAtMs = acceptedAtMs - 1_000;
  const property = `property-${label}`;
  const note = `note-${label}`;
  const payload = {
    eventId,
    cleanerSubject: lane.cleaner_subject,
    deviceId: lane.device_id,
    deviceSequence: sequence,
    eventType,
    submittedAtMs,
    property,
    note,
    ...options.payloadOverrides,
  };
  const payloadDigest =
    options.digestOverride ??
    (await digestCanonicalEvent(
      payload,
      config.eventDigestHmacKey,
      config.environment,
    ));
  const encryptedPayload = await encryptJson(
    payload,
    config.payloadEncryptionKeys.get(1)!,
    1,
    eventEncryptionContext(config.environment, eventId),
  );
  await insertEvent(env.DB, {
    eventId,
    laneId: lane.lane_id,
    deviceSequence: sequence,
    eventType,
    submittedAtMs,
    payloadDigest,
    encryptedPayload,
    acceptedAtMs,
  });
  return { eventId, lane, property, note };
}

function appsResult(
  result: string,
  ok = false,
  eventId?: string,
): AppsCallOutcome {
  return {
    kind: "result",
    response: {
      ok,
      operation: "submit_event",
      result,
      retryable: !ok,
      ...(eventId === undefined ? {} : { data: { eventId } }),
    },
  };
}

describe("scheduled delivery bridge", () => {
  it("delivers strictly one contiguous event at a time per lane", async () => {
    const config = await makeConfig();
    const first = await createFixture("fifo_1", config);
    const second = await createFixture("fifo_2", config, {
      lane: first.lane,
      sequence: 2,
      eventType: "clock_out",
    });
    const deliveredIds: string[] = [];
    const callApps = async (_config: RelayConfig, _operation: string, payload: Record<string, unknown>) => {
      deliveredIds.push(String(payload.eventId));
      return appsResult("applied", true, String(payload.eventId));
    };

    expect(
      await runDeliveryBatch(env.DB, config, {
        now: () => NOW_MS,
        callApps: callApps as never,
      }),
    ).toMatchObject({ selected: 1, delivered: 1 });
    expect(await getEvent(env.DB, second.eventId)).toMatchObject({ state: "accepted" });
    expect(
      await runDeliveryBatch(env.DB, config, {
        now: () => NOW_MS + 1,
        callApps: callApps as never,
      }),
    ).toMatchObject({ selected: 1, delivered: 1 });
    expect(deliveredIds).toEqual([first.eventId, second.eventId]);
  });

  it("processes independent lanes concurrently without exceeding five", async () => {
    const config = await makeConfig();
    for (let index = 0; index < 6; index += 1) {
      await createFixture(`concurrent_${index}`, config);
    }
    let active = 0;
    let maximum = 0;
    const callApps = async (
      _config: RelayConfig,
      _operation: string,
      payload: Record<string, unknown>,
    ) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return appsResult("applied", true, String(payload.eventId));
    };
    const summary = await runDeliveryBatch(env.DB, config, {
      now: () => NOW_MS,
      callApps: callApps as never,
    });

    expect(summary).toMatchObject({ selected: 6, delivered: 6 });
    expect(maximum).toBe(5);
  });

  it("drains accepted events after the cleaner's prior device session is revoked", async () => {
    const config = await makeConfig();
    const cleanerSubject = `cehusr_v1_${"R".repeat(43)}`;
    const priorLane = await ensureLane(env.DB, {
      laneId: "lane_delivery_revoked_device",
      cleanerSubject,
      deviceId: "device_revoked_0001",
      nowMs: NOW_MS,
    });
    const fixture = await createFixture("revoked_device", config, {
      lane: priorLane,
    });
    await createSession(env.DB, {
      sessionId: "session_delivery_prior_device",
      cleanerSubject,
      deviceId: priorLane.device_id,
      tokenHash: "hash_delivery_prior_device",
      nowMs: NOW_MS,
    });
    await createSession(env.DB, {
      sessionId: "session_delivery_replacement_device",
      cleanerSubject,
      deviceId: "device_replacement_0002",
      tokenHash: "hash_delivery_replacement_device",
      nowMs: NOW_MS + 1,
    });

    expect(
      await findActiveSessionByTokenHash(
        env.DB,
        "hash_delivery_prior_device",
        NOW_MS + 2,
      ),
    ).toBeNull();
    const summary = await runDeliveryBatch(env.DB, config, {
      now: () => NOW_MS + 2,
      callApps: (async (
        _config: RelayConfig,
        _operation: string,
        payload: Record<string, unknown>,
      ) => appsResult("applied", true, String(payload.eventId))) as never,
    });

    expect(summary).toMatchObject({ selected: 1, delivered: 1 });
    expect((await getEvent(env.DB, fixture.eventId)).state).toBe("delivered");
  });

  it("continues independent due lanes when one lane fails", async () => {
    const config = await makeConfig();
    const failed = await createFixture("isolated_failure", config);
    const delivered = await createFixture("isolated_success", config);
    const summary = await runDeliveryBatch(env.DB, config, {
      now: () => NOW_MS,
      randomUnit: () => 0,
      callApps: (async (
        _config: RelayConfig,
        _operation: string,
        payload: Record<string, unknown>,
      ) =>
        payload.eventId === failed.eventId
          ? { kind: "failure", category: "timeout" }
          : appsResult("applied", true, String(payload.eventId))) as never,
    });

    expect(summary).toMatchObject({ selected: 2, delivered: 1, retryable: 1 });
    expect((await getEvent(env.DB, failed.eventId)).state).toBe("retryable_failure");
    expect((await getEvent(env.DB, delivered.eventId)).state).toBe("delivered");
  });

  it("blocks a sequence gap without delivering a later event", async () => {
    const config = await makeConfig();
    const fixture = await createFixture("gap", config, { sequence: 2 });
    let calls = 0;
    const summary = await runDeliveryBatch(env.DB, config, {
      now: () => NOW_MS,
      callApps: (async () => {
        calls += 1;
        return appsResult("applied", true);
      }) as never,
    });
    const lane = await env.DB.prepare("SELECT * FROM relay_lanes WHERE lane_id = ?")
      .bind(fixture.lane.lane_id)
      .first<RelayLaneRow>();

    expect(summary).toMatchObject({ selected: 0, gapsBlocked: 1 });
    expect(calls).toBe(0);
    expect(lane).toMatchObject({
      status: "blocked",
      blocked_reason: "sequence_gap",
      gap_missing_from_sequence: 1,
      gap_missing_to_sequence: 1,
    });
  });

  it("maps applied and already_applied to delivered", async () => {
    const config = await makeConfig();
    const applied = await createFixture("applied", config);
    const duplicate = await createFixture("already", config);
    await runDeliveryBatch(env.DB, config, {
      now: () => NOW_MS,
      callApps: (async (_config: RelayConfig, _operation: string, payload: Record<string, unknown>) =>
        appsResult(
          payload.eventId === applied.eventId ? "applied" : "already_applied",
          true,
          String(payload.eventId),
        )) as never,
    });

    expect((await getEvent(env.DB, applied.eventId)).state).toBe("delivered");
    expect((await getEvent(env.DB, duplicate.eventId)).state).toBe("delivered");
  });

  it("never delivers malformed success or unknown Apps Script results", async () => {
    const config = await makeConfig();
    const malformed = await createFixture("malformed_response", config);
    const unknown = await createFixture("unknown_response", config);
    const summary = await runDeliveryBatch(env.DB, config, {
      now: () => NOW_MS,
      randomUnit: () => 0,
      callApps: (async (
        _config: RelayConfig,
        _operation: string,
        payload: Record<string, unknown>,
      ) =>
        payload.eventId === malformed.eventId
          ? {
              kind: "result",
              response: {
                ok: true,
                operation: "submit_event",
                result: "applied",
                retryable: false,
                data: { eventId: "event_wrong_response_identity" },
              },
            }
          : appsResult("unexpected_result")) as never,
    });

    expect(summary).toMatchObject({ selected: 2, delivered: 0, retryable: 2 });
    for (const fixture of [malformed, unknown]) {
      expect(await getEvent(env.DB, fixture.eventId)).toMatchObject({
        state: "retryable_failure",
        failure_category: "apps_script_protocol_error",
        delivered_at_ms: null,
        lease_owner: null,
      });
    }
  });

  it("keeps every retryable Apps result nonterminal", async () => {
    const config = await makeConfig();
    const results = [
      "lock_busy",
      "stale_request",
      "replay_detected",
      "temporary_google_failure",
      "internal_error",
      "authentication_failed",
    ];
    const fixtures = await Promise.all(
      results.map((result) => createFixture(`retry_${result}`, config)),
    );
    await runDeliveryBatch(env.DB, config, {
      now: () => NOW_MS,
      randomUnit: () => 0,
      callApps: (async (_config: RelayConfig, _operation: string, payload: Record<string, unknown>) => {
        const index = fixtures.findIndex((fixture) => fixture.eventId === payload.eventId);
        return appsResult(results[index]);
      }) as never,
    });

    for (const fixture of fixtures) {
      expect(await getEvent(env.DB, fixture.eventId)).toMatchObject({
        state: "retryable_failure",
        lease_owner: null,
        lease_expires_at_ms: null,
        terminal_at_ms: null,
      });
    }
  });

  it("finalizes every permanent Apps result and clears its lease", async () => {
    const config = await makeConfig();
    const results = ["event_conflict", "invalid_event", "business_rejected"];
    const fixtures = await Promise.all(
      results.map((result) => createFixture(`terminal_${result}`, config)),
    );
    await runDeliveryBatch(env.DB, config, {
      now: () => NOW_MS,
      callApps: (async (_config: RelayConfig, _operation: string, payload: Record<string, unknown>) => {
        const index = fixtures.findIndex((fixture) => fixture.eventId === payload.eventId);
        return appsResult(results[index]);
      }) as never,
    });

    for (const fixture of fixtures) {
      expect(await getEvent(env.DB, fixture.eventId)).toMatchObject({
        state: "terminal_failure",
        lease_owner: null,
        lease_expires_at_ms: null,
      });
    }
  });

  it("enters attention after sixty minutes and two genuine attempts", async () => {
    const config = await makeConfig();
    const acceptedAtMs = NOW_MS - ATTENTION_REQUIRED_AGE_MS - 1;
    const fixture = await createFixture("attention", config, { acceptedAtMs });
    let nowMs = NOW_MS;
    const callApps = async () => appsResult("temporary_google_failure");

    await runDeliveryBatch(env.DB, config, {
      now: () => nowMs,
      randomUnit: () => 0,
      callApps: callApps as never,
    });
    expect((await getEvent(env.DB, fixture.eventId)).state).toBe("retryable_failure");

    nowMs += 60_000;
    await runDeliveryBatch(env.DB, config, {
      now: () => nowMs,
      randomUnit: () => 0,
      callApps: callApps as never,
    });
    const attention = await getEvent(env.DB, fixture.eventId);
    expect(attention).toMatchObject({
      state: "attention_required",
      attempt_count: 2,
      lease_owner: null,
      terminal_at_ms: null,
    });
    expect(attention.next_attempt_at_ms - nowMs).toBe(6 * 60 * 60 * 1_000);

    nowMs = attention.next_attempt_at_ms;
    await runDeliveryBatch(env.DB, config, {
      now: () => nowMs,
      randomUnit: () => 1,
      callApps: callApps as never,
    });
    expect(await getEvent(env.DB, fixture.eventId)).toMatchObject({
      state: "attention_required",
      attempt_count: 3,
      terminal_at_ms: null,
      lease_owner: null,
    });
  });

  it("honors a bounded Retry-After without making the event terminal", async () => {
    const config = await makeConfig();
    const fixture = await createFixture("retry_after", config);
    await runDeliveryBatch(env.DB, config, {
      now: () => NOW_MS,
      randomUnit: () => 0,
      callApps: (async () => ({
        kind: "failure",
        category: "rate_limited",
        retryAfterMs: 2 * 60 * 60 * 1_000,
      })) as never,
    });
    const event = await getEvent(env.DB, fixture.eventId);

    expect(event).toMatchObject({ state: "retryable_failure", terminal_at_ms: null });
    expect(event.next_attempt_at_ms).toBe(NOW_MS + 2 * 60 * 60 * 1_000);
  });

  it("rejects immutable payload or digest corruption before Apps Script", async () => {
    const config = await makeConfig();
    const identityMismatch = await createFixture("identity_corrupt", config, {
      payloadOverrides: { deviceId: "device_corrupt_9999" },
    });
    const digestMismatch = await createFixture("digest_corrupt", config, {
      digestOverride: "Z".repeat(43),
    });
    let calls = 0;
    await runDeliveryBatch(env.DB, config, {
      now: () => NOW_MS,
      callApps: (async () => {
        calls += 1;
        return appsResult("applied", true);
      }) as never,
    });

    expect(calls).toBe(0);
    for (const fixture of [identityMismatch, digestMismatch]) {
      expect(await getEvent(env.DB, fixture.eventId)).toMatchObject({
        state: "terminal_failure",
        failure_category: "corrupt_event",
        lease_owner: null,
      });
    }
  });

  it("converges an ambiguous timeout through already_applied", async () => {
    const config = await makeConfig();
    const fixture = await createFixture("ambiguous", config);
    let calls = 0;
    let nowMs = NOW_MS;
    const callApps = async () => {
      calls += 1;
      return calls === 1
        ? ({ kind: "failure", category: "timeout" } satisfies AppsCallOutcome)
        : appsResult("already_applied", true, fixture.eventId);
    };
    await runDeliveryBatch(env.DB, config, {
      now: () => nowMs,
      randomUnit: () => 0,
      callApps: callApps as never,
    });
    nowMs += 60_000;
    await runDeliveryBatch(env.DB, config, {
      now: () => nowMs,
      randomUnit: () => 0,
      callApps: callApps as never,
    });

    expect(calls).toBe(2);
    expect(await getEvent(env.DB, fixture.eventId)).toMatchObject({
      state: "delivered",
      attempt_count: 2,
      failure_category: null,
    });
  });
});
/* end[relay_delivery_service_tests] */

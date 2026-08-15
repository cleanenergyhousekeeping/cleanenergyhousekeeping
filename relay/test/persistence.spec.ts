import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  digestCanonicalEvent,
  encryptJson,
  eventEncryptionContext,
  generateSecureId,
  hashRelayToken,
  importEncryptionKey,
  importHmacKey,
} from "../src/crypto";
import {
  blockLaneForSequenceGap,
  calculateRetryDelayMs,
  claimEventLease,
  ensureLane,
  getEvent,
  insertEvent,
  isEventStateTransitionAllowed,
  markEventDelivered,
  markEventPending,
  markLeasedTerminalFailure,
  markPreDeliveryTerminalFailure,
  resolveSequenceGap,
  scheduleInfrastructureFailure,
} from "../src/persistence/events";
import {
  addIncidentEvent,
  enqueueIncidentNotification,
  getOrCreateIncident,
} from "../src/persistence/notifications";
import { redactDeliveredEventPayloads } from "../src/persistence/retention";
import {
  cleanupExpiredSessions,
  createSession,
  expireSessions,
  findActiveSessionByTokenHash,
  RELAY_TOKEN_ROTATION_OVERLAP_MS,
  rotateSessionToken,
} from "../src/persistence/sessions";
import type {
  EncryptedValue,
  EventType,
  RelayLaneRow,
} from "../src/persistence/types";

/* begin[relay_persistence_tests] */
const NOW_MS = Date.UTC(2026, 7, 15, 20, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1_000;

interface EventFixture {
  eventId: string;
  lane: RelayLaneRow;
  payloadDigest: string;
  encryptedPayload: EncryptedValue;
}

async function createEventFixture(
  label: string,
  options: {
    deviceSequence?: number;
    eventType?: EventType;
    acceptedAtMs?: number;
  } = {},
): Promise<EventFixture> {
  const acceptedAtMs = options.acceptedAtMs ?? NOW_MS;
  const lane = await ensureLane(env.DB, {
    laneId: `lane_${label}`,
    cleanerSubject: `cleaner_subject_${label}`,
    deviceId: `device_${label}`,
    nowMs: acceptedAtMs,
  });
  const eventId = `event_${label}`;
  const eventType = options.eventType ?? "clock_in";
  const deviceSequence = options.deviceSequence ?? 1;
  const property = `synthetic-property-${label}`;
  const note = `synthetic-note-${label}`;
  const digestKey = await importHmacKey(`digest-key-${label}`);
  const encryptionKey = await importEncryptionKey(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const payloadDigest = await digestCanonicalEvent(
    { eventId, deviceSequence, eventType, property, note },
    digestKey,
  );
  const encryptedPayload = await encryptJson(
    { property, cleanerDisplayName: `synthetic-cleaner-${label}`, note },
    encryptionKey,
    1,
    eventEncryptionContext(eventId),
  );

  const result = await insertEvent(env.DB, {
    eventId,
    laneId: lane.lane_id,
    deviceSequence,
    eventType,
    submittedAtMs: acceptedAtMs - 1_000,
    payloadDigest,
    encryptedPayload,
    acceptedAtMs,
  });
  expect(result.outcome).toBe("inserted");

  return { eventId, lane, payloadDigest, encryptedPayload };
}

async function makePending(eventId: string, nowMs = NOW_MS): Promise<void> {
  expect(await markEventPending(env.DB, eventId, nowMs)).toBe(true);
}

describe("Wrangler D1 migrations", () => {
  it("applies the versioned schema to an empty isolated local database", async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const tableRows = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE '_cf_%'
       ORDER BY name`,
    ).all<{ name: string }>();
    const tableNames = tableRows.results.map((row) => row.name);

    expect(tableNames).toEqual(
      expect.arrayContaining([
        "d1_migrations",
        "incident_event_membership",
        "notification_incidents",
        "notification_outbox",
        "relay_events",
        "relay_lanes",
        "relay_sequence_gap_resolutions",
        "relay_session_tokens",
        "relay_sessions",
        "relay_state_snapshots",
      ]),
    );
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM d1_migrations").first<{
        count: number;
      }>("count"),
    ).toBe(1);
  });
});

describe("event insertion and idempotency", () => {
  it("returns the existing event for an identical replay", async () => {
    const fixture = await createEventFixture("identical");
    const replay = await insertEvent(env.DB, {
      eventId: fixture.eventId,
      laneId: fixture.lane.lane_id,
      deviceSequence: 1,
      eventType: "clock_in",
      submittedAtMs: NOW_MS - 1_000,
      payloadDigest: fixture.payloadDigest,
      encryptedPayload: fixture.encryptedPayload,
      acceptedAtMs: NOW_MS + 1,
    });

    expect(replay.outcome).toBe("identical_duplicate");
  });

  it("detects a conflicting event ID", async () => {
    const fixture = await createEventFixture("event-id-conflict");
    const conflict = await insertEvent(env.DB, {
      eventId: fixture.eventId,
      laneId: fixture.lane.lane_id,
      deviceSequence: 2,
      eventType: "clock_out",
      submittedAtMs: NOW_MS,
      payloadDigest: `${fixture.payloadDigest}-different`,
      encryptedPayload: fixture.encryptedPayload,
      acceptedAtMs: NOW_MS + 1,
    });

    expect(conflict.outcome).toBe("event_id_conflict");
  });

  it("detects a conflicting cleaner/device sequence", async () => {
    const fixture = await createEventFixture("sequence-conflict");
    const conflict = await insertEvent(env.DB, {
      eventId: "event_sequence-conflict-second",
      laneId: fixture.lane.lane_id,
      deviceSequence: 1,
      eventType: "clock_in",
      submittedAtMs: NOW_MS,
      payloadDigest: `${fixture.payloadDigest}-different`,
      encryptedPayload: fixture.encryptedPayload,
      acceptedAtMs: NOW_MS + 1,
    });

    expect(conflict.outcome).toBe("sequence_conflict");
  });
});

describe("state transitions and leases", () => {
  it("allows valid transitions and rejects invalid transitions", async () => {
    const fixture = await createEventFixture("transitions");

    expect(isEventStateTransitionAllowed("accepted", "pending")).toBe(true);
    expect(isEventStateTransitionAllowed("delivering", "delivered")).toBe(true);
    expect(isEventStateTransitionAllowed("pending", "delivered")).toBe(false);
    expect(isEventStateTransitionAllowed("delivered", "pending")).toBe(false);
    expect(await markEventPending(env.DB, fixture.eventId, NOW_MS)).toBe(true);
    expect(await markEventPending(env.DB, fixture.eventId, NOW_MS)).toBe(false);
    expect((await getEvent(env.DB, fixture.eventId)).state).toBe("pending");
  });

  it("grants only one conditional lease claim", async () => {
    const fixture = await createEventFixture("lease-race");
    await makePending(fixture.eventId);

    const claims = await Promise.all([
      claimEventLease(env.DB, fixture.eventId, "worker_a", NOW_MS, 120_000),
      claimEventLease(env.DB, fixture.eventId, "worker_b", NOW_MS, 120_000),
    ]);

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it("recovers an expired lease", async () => {
    const fixture = await createEventFixture("expired-lease");
    await makePending(fixture.eventId);
    expect(
      await claimEventLease(
        env.DB,
        fixture.eventId,
        "worker_original",
        NOW_MS,
        1_000,
      ),
    ).not.toBeNull();

    const recovered = await claimEventLease(
      env.DB,
      fixture.eventId,
      "worker_recovery",
      NOW_MS + 1_001,
      1_000,
    );
    expect(recovered?.lease_owner).toBe("worker_recovery");
    expect(recovered?.attempt_count).toBe(2);
  });

  it("blocks lease claims while a lane is blocked", async () => {
    const fixture = await createEventFixture("blocked-lane");
    await makePending(fixture.eventId);
    expect(
      await blockLaneForSequenceGap(env.DB, {
        laneId: fixture.lane.lane_id,
        missingFromSequence: 1,
        missingToSequence: 1,
        nowMs: NOW_MS,
      }),
    ).toBe(true);

    expect(
      await claimEventLease(
        env.DB,
        fixture.eventId,
        "worker_blocked",
        NOW_MS,
        1_000,
      ),
    ).toBeNull();
  });
});

describe("failure scheduling", () => {
  it("keeps infrastructure failures retryable", async () => {
    const fixture = await createEventFixture("retryable");
    await makePending(fixture.eventId);
    await claimEventLease(
      env.DB,
      fixture.eventId,
      "worker_retry",
      NOW_MS,
      1_000,
    );
    const nextAttemptAtMs = NOW_MS + calculateRetryDelayMs(15, false, 0.5);

    expect(
      await scheduleInfrastructureFailure(env.DB, {
        eventId: fixture.eventId,
        leaseOwner: "worker_retry",
        category: "apps_script_unavailable",
        nowMs: NOW_MS,
        nextAttemptAtMs,
        attentionRequired: false,
      }),
    ).toBe(true);
    const event = await getEvent(env.DB, fixture.eventId);
    expect(event.state).toBe("retryable_failure");
    expect(event.terminal_at_ms).toBeNull();
    expect(event.next_attempt_at_ms).toBe(nextAttemptAtMs);
  });

  it("moves to attention_required and remains eligible for future retries", async () => {
    const fixture = await createEventFixture("attention");
    await makePending(fixture.eventId);
    await claimEventLease(
      env.DB,
      fixture.eventId,
      "worker_attention",
      NOW_MS,
      1_000,
    );
    const nextAttemptAtMs = NOW_MS + calculateRetryDelayMs(30, true, 0);
    await scheduleInfrastructureFailure(env.DB, {
      eventId: fixture.eventId,
      leaseOwner: "worker_attention",
      category: "google_unavailable",
      nowMs: NOW_MS,
      nextAttemptAtMs,
      attentionRequired: true,
    });

    expect((await getEvent(env.DB, fixture.eventId)).state).toBe(
      "attention_required",
    );
    expect(
      await claimEventLease(
        env.DB,
        fixture.eventId,
        "worker_late_retry",
        nextAttemptAtMs,
        1_000,
      ),
    ).not.toBeNull();
  });

  it("allows a pre-delivery terminal transition without a lease", async () => {
    const fixture = await createEventFixture("terminal");

    expect(
      await markPreDeliveryTerminalFailure(env.DB, {
        eventId: fixture.eventId,
        category: "corrupt_event",
        nowMs: NOW_MS,
      }),
    ).toBe(true);
    expect((await getEvent(env.DB, fixture.eventId)).state).toBe(
      "terminal_failure",
    );
    const lane = await env.DB.prepare(
      "SELECT * FROM relay_lanes WHERE lane_id = ?",
    )
      .bind(fixture.lane.lane_id)
      .first<RelayLaneRow>();
    expect(lane?.blocked_reason).toBe("terminal_event");
  });

  it("allows a terminal transition with the matching active lease", async () => {
    const fixture = await createEventFixture("leased-terminal");
    await makePending(fixture.eventId);
    await claimEventLease(
      env.DB,
      fixture.eventId,
      "worker_terminal",
      NOW_MS,
      60_000,
    );

    expect(
      await markLeasedTerminalFailure(env.DB, {
        eventId: fixture.eventId,
        category: "permanent_business_rejection",
        nowMs: NOW_MS + 1,
        leaseOwner: "worker_terminal",
      }),
    ).toBe(true);
    const event = await getEvent(env.DB, fixture.eventId);
    expect(event.state).toBe("terminal_failure");
    expect(event.lease_owner).toBeNull();
  });

  it("rejects a terminal transition from the wrong lease owner", async () => {
    const fixture = await createEventFixture("wrong-terminal-owner");
    await makePending(fixture.eventId);
    await claimEventLease(
      env.DB,
      fixture.eventId,
      "worker_active",
      NOW_MS,
      60_000,
    );

    expect(
      await markLeasedTerminalFailure(env.DB, {
        eventId: fixture.eventId,
        category: "permanent_business_rejection",
        nowMs: NOW_MS + 1,
        leaseOwner: "worker_wrong",
      }),
    ).toBe(false);
    const event = await getEvent(env.DB, fixture.eventId);
    const lane = await env.DB.prepare(
      "SELECT * FROM relay_lanes WHERE lane_id = ?",
    )
      .bind(fixture.lane.lane_id)
      .first<RelayLaneRow>();
    expect(event.state).toBe("delivering");
    expect(event.lease_owner).toBe("worker_active");
    expect(lane?.status).toBe("active");
    expect(lane?.blocked_reason).toBeNull();
  });

  it("rejects a lease-free terminal transition for a delivering event", async () => {
    const fixture = await createEventFixture("missing-terminal-owner");
    await makePending(fixture.eventId);
    await claimEventLease(
      env.DB,
      fixture.eventId,
      "worker_active",
      NOW_MS,
      60_000,
    );

    expect(
      await markPreDeliveryTerminalFailure(env.DB, {
        eventId: fixture.eventId,
        category: "permanent_business_rejection",
        nowMs: NOW_MS + 1,
      }),
    ).toBe(false);
    const event = await getEvent(env.DB, fixture.eventId);
    const lane = await env.DB.prepare(
      "SELECT * FROM relay_lanes WHERE lane_id = ?",
    )
      .bind(fixture.lane.lane_id)
      .first<RelayLaneRow>();
    expect(event.state).toBe("delivering");
    expect(event.lease_owner).toBe("worker_active");
    expect(lane?.status).toBe("active");
    expect(lane?.blocked_reason).toBeNull();
  });

  it("rejects a terminal transition after the matching lease expires", async () => {
    const fixture = await createEventFixture("expired-terminal-lease");
    await makePending(fixture.eventId);
    await claimEventLease(
      env.DB,
      fixture.eventId,
      "worker_expired",
      NOW_MS,
      1_000,
    );

    expect(
      await markLeasedTerminalFailure(env.DB, {
        eventId: fixture.eventId,
        category: "permanent_business_rejection",
        nowMs: NOW_MS + 1_001,
        leaseOwner: "worker_expired",
      }),
    ).toBe(false);
    const event = await getEvent(env.DB, fixture.eventId);
    expect(event.state).toBe("delivering");
    expect(event.lease_owner).toBe("worker_expired");
  });

  it("delivers earlier FIFO events before blocking on a later terminal event", async () => {
    const fixture = await createEventFixture("future-terminal");
    const terminalEventId = "event_future-terminal-second";
    expect(
      (
        await insertEvent(env.DB, {
          eventId: terminalEventId,
          laneId: fixture.lane.lane_id,
          deviceSequence: 2,
          eventType: "clock_out",
          submittedAtMs: NOW_MS + 1,
          payloadDigest: `${fixture.payloadDigest}-second`,
          encryptedPayload: fixture.encryptedPayload,
          acceptedAtMs: NOW_MS + 1,
        })
      ).outcome,
    ).toBe("inserted");
    await markPreDeliveryTerminalFailure(env.DB, {
      eventId: terminalEventId,
      category: "permanent_business_rejection",
      nowMs: NOW_MS + 2,
    });
    expect(
      await env.DB.prepare("SELECT status FROM relay_lanes WHERE lane_id = ?")
        .bind(fixture.lane.lane_id)
        .first<string>("status"),
    ).toBe("active");

    await makePending(fixture.eventId, NOW_MS + 3);
    await claimEventLease(
      env.DB,
      fixture.eventId,
      "worker_fifo",
      NOW_MS + 3,
      1_000,
    );
    expect(
      await markEventDelivered(
        env.DB,
        fixture.eventId,
        "worker_fifo",
        NOW_MS + 4,
      ),
    ).toBe(true);
    const lane = await env.DB.prepare(
      "SELECT * FROM relay_lanes WHERE lane_id = ?",
    )
      .bind(fixture.lane.lane_id)
      .first<RelayLaneRow>();
    expect(lane?.next_delivery_sequence).toBe(2);
    expect(lane?.blocked_reason).toBe("terminal_event");
  });
});

describe("audited sequence-gap repair", () => {
  it("records a gap and advances only through an audited resolution", async () => {
    const lane = await ensureLane(env.DB, {
      laneId: "lane_gap-resolution",
      cleanerSubject: "cleaner_subject_gap-resolution",
      deviceId: "device_gap-resolution",
      nowMs: NOW_MS,
    });
    expect(
      await blockLaneForSequenceGap(env.DB, {
        laneId: lane.lane_id,
        missingFromSequence: 1,
        missingToSequence: 2,
        nowMs: NOW_MS,
      }),
    ).toBe(true);

    expect(
      await resolveSequenceGap(env.DB, {
        resolutionId: "resolution_gap-resolution",
        laneId: lane.lane_id,
        missingFromSequence: 1,
        missingToSequence: 2,
        reasonCode: "lost_browser_storage",
        operatorSubjectHash: "operator_subject_hash",
        d1VerifiedAtMs: NOW_MS + 1,
        appsLedgerVerifiedAtMs: NOW_MS + 2,
        nowMs: NOW_MS + 3,
      }),
    ).toBe(true);

    const repairedLane = await env.DB.prepare(
      "SELECT * FROM relay_lanes WHERE lane_id = ?",
    )
      .bind(lane.lane_id)
      .first<RelayLaneRow>();
    expect(repairedLane?.status).toBe("active");
    expect(repairedLane?.next_delivery_sequence).toBe(3);
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM relay_sequence_gap_resolutions
         WHERE lane_id = ?`,
      )
        .bind(lane.lane_id)
        .first<number>("count"),
    ).toBe(1);
  });

  it("refuses to resolve a gap when D1 contains an event in the range", async () => {
    const fixture = await createEventFixture("gap-refused");
    await blockLaneForSequenceGap(env.DB, {
      laneId: fixture.lane.lane_id,
      missingFromSequence: 1,
      missingToSequence: 1,
      nowMs: NOW_MS,
    });

    expect(
      await resolveSequenceGap(env.DB, {
        resolutionId: "resolution_gap-refused",
        laneId: fixture.lane.lane_id,
        missingFromSequence: 1,
        missingToSequence: 1,
        reasonCode: "corruption",
        operatorSubjectHash: "operator_subject_hash",
        d1VerifiedAtMs: NOW_MS,
        appsLedgerVerifiedAtMs: NOW_MS,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });
});

describe("session lifecycle", () => {
  it("supports hashed-token rotation with a ten-minute overlap", async () => {
    const hmacKey = await importHmacKey("synthetic-session-hmac-material");
    const oldToken = generateSecureId("token");
    const nextToken = generateSecureId("token");
    const oldHash = await hashRelayToken(oldToken, hmacKey);
    const nextHash = await hashRelayToken(nextToken, hmacKey);
    const session = await createSession(env.DB, {
      sessionId: "session_rotation",
      cleanerSubject: "cleaner_subject_rotation",
      deviceId: "device_rotation",
      tokenHash: oldHash,
      nowMs: NOW_MS,
    });

    expect(
      await rotateSessionToken(
        env.DB,
        session.session_id,
        nextHash,
        NOW_MS + 1_000,
      ),
    ).toBe(true);
    expect(
      await findActiveSessionByTokenHash(
        env.DB,
        oldHash,
        NOW_MS + RELAY_TOKEN_ROTATION_OVERLAP_MS,
      ),
    ).not.toBeNull();
    expect(
      await findActiveSessionByTokenHash(
        env.DB,
        oldHash,
        NOW_MS + RELAY_TOKEN_ROTATION_OVERLAP_MS + 1_001,
      ),
    ).toBeNull();
    expect(
      await findActiveSessionByTokenHash(
        env.DB,
        nextHash,
        NOW_MS + RELAY_TOKEN_ROTATION_OVERLAP_MS + 1_001,
      ),
    ).not.toBeNull();
  });

  it("revokes the prior device when the cleaner enrolls another device", async () => {
    await createSession(env.DB, {
      sessionId: "session_prior-device",
      cleanerSubject: "cleaner_subject_device-replacement",
      deviceId: "device_prior",
      tokenHash: "hash_prior-device",
      nowMs: NOW_MS,
    });
    await createSession(env.DB, {
      sessionId: "session_next-device",
      cleanerSubject: "cleaner_subject_device-replacement",
      deviceId: "device_next",
      tokenHash: "hash_next-device",
      nowMs: NOW_MS + 1,
    });

    expect(
      await findActiveSessionByTokenHash(env.DB, "hash_prior-device", NOW_MS + 2),
    ).toBeNull();
    expect(
      await findActiveSessionByTokenHash(env.DB, "hash_next-device", NOW_MS + 2),
    ).not.toBeNull();
  });

  it("deletes sessions thirty days after revocation or expiration", async () => {
    await createSession(env.DB, {
      sessionId: "session_cleanup",
      cleanerSubject: "cleaner_subject_cleanup",
      deviceId: "device_cleanup",
      tokenHash: "hash_cleanup",
      nowMs: NOW_MS - 40 * DAY_MS,
    });

    expect(await expireSessions(env.DB, NOW_MS)).toBeGreaterThanOrEqual(1);
    expect(await cleanupExpiredSessions(env.DB, NOW_MS)).toBeGreaterThanOrEqual(1);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM relay_sessions WHERE session_id = ?",
      )
        .bind("session_cleanup")
        .first<number>("count"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM relay_session_tokens
         WHERE session_id = ?`,
      )
        .bind("session_cleanup")
        .first<number>("count"),
    ).toBe(0);
  });
});

describe("notification durability", () => {
  it("deduplicates incidents, membership, and outbox transitions", async () => {
    const fixture = await createEventFixture("incident-dedupe");
    const incident = await getOrCreateIncident(env.DB, {
      incidentId: "incident_dedupe",
      incidentKey: "apps-outage:test",
      category: "apps_google_outage",
      scopeHash: "scope_hash_test",
      nowMs: NOW_MS,
    });
    const duplicateIncident = await getOrCreateIncident(env.DB, {
      incidentId: "incident_dedupe_second",
      incidentKey: "apps-outage:test",
      category: "apps_google_outage",
      scopeHash: "scope_hash_test",
      nowMs: NOW_MS + 1,
    });

    expect(duplicateIncident.incident_id).toBe(incident.incident_id);
    expect(
      await addIncidentEvent(env.DB, incident.incident_id, fixture.eventId, NOW_MS),
    ).toBe(true);
    expect(
      await addIncidentEvent(env.DB, incident.incident_id, fixture.eventId, NOW_MS),
    ).toBe(false);
    expect(
      await enqueueIncidentNotification(env.DB, {
        notificationId: "notification_dedupe",
        incidentId: incident.incident_id,
        dedupeKey: `${incident.incident_id}:opened:v1`,
        transitionType: "opened",
        availableAtMs: NOW_MS,
        nowMs: NOW_MS,
      }),
    ).toBe(true);
    expect(
      await enqueueIncidentNotification(env.DB, {
        notificationId: "notification_dedupe_second",
        incidentId: incident.incident_id,
        dedupeKey: `${incident.incident_id}:opened:v1`,
        transitionType: "opened",
        availableAtMs: NOW_MS,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });
});

describe("retention and sensitive-data boundaries", () => {
  it("redacts delivered encrypted payloads after thirty days", async () => {
    const deliveredAtMs = NOW_MS - 31 * DAY_MS;
    const fixture = await createEventFixture("redaction", {
      acceptedAtMs: deliveredAtMs - 1_000,
    });
    await makePending(fixture.eventId, deliveredAtMs - 500);
    await claimEventLease(
      env.DB,
      fixture.eventId,
      "worker_redaction",
      deliveredAtMs - 400,
      1_000,
    );
    await markEventDelivered(
      env.DB,
      fixture.eventId,
      "worker_redaction",
      deliveredAtMs,
    );

    expect(await redactDeliveredEventPayloads(env.DB, NOW_MS)).toBe(1);
    const event = await getEvent(env.DB, fixture.eventId);
    expect(event.payload_ciphertext).toBeNull();
    expect(event.payload_nonce).toBeNull();
    expect(event.encryption_key_version).toBeNull();
    expect(event.payload_digest).toBe(fixture.payloadDigest);
  });

  it("never stores plaintext event fields or raw relay tokens", async () => {
    const label = generateSecureId("negative", 16);
    const property = `property-${label}`;
    const cleanerDisplayName = `cleaner-${label}`;
    const note = `note-${label}`;
    const rawToken = generateSecureId("token");
    const hmacKey = await importHmacKey("synthetic-negative-hmac-material");
    const tokenHash = await hashRelayToken(rawToken, hmacKey);
    await createSession(env.DB, {
      sessionId: `session_${label}`,
      cleanerSubject: `subject_${label}`,
      deviceId: `device_${label}`,
      tokenHash,
      nowMs: NOW_MS,
    });
    const lane = await ensureLane(env.DB, {
      laneId: `lane_${label}`,
      cleanerSubject: `subject_${label}`,
      deviceId: `device_${label}`,
      nowMs: NOW_MS,
    });
    const encryptionKey = await importEncryptionKey(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const encryptedPayload = await encryptJson(
      { property, cleanerDisplayName, note },
      encryptionKey,
      1,
      eventEncryptionContext(`event_${label}`),
    );
    const payloadDigest = await digestCanonicalEvent(
      { property, cleanerDisplayName, note },
      hmacKey,
    );
    await insertEvent(env.DB, {
      eventId: `event_${label}`,
      laneId: lane.lane_id,
      deviceSequence: 1,
      eventType: "add_note",
      submittedAtMs: NOW_MS,
      payloadDigest,
      encryptedPayload,
      acceptedAtMs: NOW_MS,
    });

    const eventRows = await env.DB.prepare(
      "SELECT * FROM relay_events WHERE event_id = ?",
    )
      .bind(`event_${label}`)
      .all();
    const tokenRows = await env.DB.prepare(
      "SELECT * FROM relay_session_tokens WHERE session_id = ?",
    )
      .bind(`session_${label}`)
      .all();
    const storedText = JSON.stringify([eventRows.results, tokenRows.results]);

    expect(storedText).not.toContain(property);
    expect(storedText).not.toContain(cleanerDisplayName);
    expect(storedText).not.toContain(note);
    expect(storedText).not.toContain(rawToken);
    expect(storedText).toContain(tokenHash);
  });
});
/* end[relay_persistence_tests] */

import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../src/index";
import { ALLOWED_ORIGIN, createCorsHeaders } from "../src/cors";
import { bytesToBase64Url, generateSecureId, hashRelayToken } from "../src/crypto";
import { healthResponse } from "../src/health";
import { loadRelayConfig } from "../src/config";
import { createSession } from "../src/persistence/sessions";

/* begin[relay_worker_tests] */
const HEALTH_URL = "https://relay.test/health";
const FOREIGN_ORIGIN = "https://example.com";
const HEALTHY_BODY = {
  ok: true,
  service: "ceh-relay",
  environment: "test",
  storage: "ok",
  version: "0.1.0",
};
const UNAVAILABLE_BODY = {
  ok: false,
  service: "ceh-relay",
  environment: "test",
  storage: "unavailable",
  version: "0.1.0",
};
const EVENT_BODY = {
  eventId: "event_router_123456789",
  deviceSequence: 1,
  eventType: "clock_in",
  submittedAtMs: Date.UTC(2026, 7, 16, 20, 0, 0),
  property: "Synthetic Property",
  note: "Synthetic note",
};

function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`https://relay.test${path}`, init));
}

async function makeRouterEnv(database: D1Database = env.DB): Promise<Env> {
  const encodedKey = bytesToBase64Url(new Uint8Array(32).fill(11));
  return {
    DB: database,
    CEH_RELAY_ENVIRONMENT: "test",
    CEH_RELAY_APPS_ACTIVE_KEY_ID: "test-v1",
    CEH_RELAY_PAYLOAD_ACTIVE_KEY_VERSION: "1",
    CEH_RELAY_APPS_URL: "https://script.google.test/macros/s/synthetic/exec",
    CEH_RELAY_APPS_HMAC_KEYS_JSON: JSON.stringify({ "test-v1": encodedKey }),
    CEH_RELAY_TOKEN_HMAC_KEY: encodedKey,
    CEH_RELAY_EVENT_DIGEST_HMAC_KEY: encodedKey,
    CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON: JSON.stringify({ 1: encodedKey }),
  } as Env;
}

function eventRequest(
  token: string,
  body: unknown = EVENT_BODY,
  headers: HeadersInit = {},
): Request {
  return new Request("https://relay.test/v1/relay-events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function directWorkerFetch(request: Request, testEnv: Env): Promise<Response> {
  return worker.fetch(request as Parameters<typeof worker.fetch>[0], testEnv);
}

describe("GET /health", () => {
  it("returns the exact successful contract without an Origin header", async () => {
    const response = await workerFetch("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(HEALTHY_BODY);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("allows the exact CEH origin", async () => {
    const response = await workerFetch("/health", {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("rejects a supplied foreign origin with sanitized JSON", async () => {
    const response = await workerFetch("/health", {
      headers: { Origin: FOREIGN_ORIGIN },
    });
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(JSON.parse(body)).toEqual({
      ok: false,
      error: "origin_not_allowed",
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(body).not.toContain(FOREIGN_ORIGIN);
  });
});

describe("D1 failures", () => {
  it("returns the exact sanitized 503 contract without raw errors", async () => {
    const rawError = "sensitive raw D1 failure";
    const unavailableDatabase = {
      prepare(): never {
        throw new Error(rawError);
      },
    } as unknown as D1Database;

    const response = await healthResponse(
      unavailableDatabase,
      createCorsHeaders(null),
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual(UNAVAILABLE_BODY);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(body).not.toContain(rawError);
    expect(body).not.toContain("stack");
    expect(body).not.toContain("database_id");
    expect(body).not.toContain("DB");
  });
});

describe("OPTIONS /health", () => {
  it("accepts a valid GET preflight from the CEH origin", async () => {
    const response = await workerFetch("/health", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("rejects an unsupported preflight method", async () => {
    const response = await workerFetch("/health", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      ok: false,
      error: "method_not_allowed",
    });
    expect(response.headers.get("Allow")).toBe("GET, OPTIONS");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("session route preflights", () => {
  it("allows only the approved enrollment headers and method", async () => {
    const response = await workerFetch("/v1/relay-sessions/enroll", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("allows bearer authorization only on renewal", async () => {
    const response = await workerFetch("/v1/relay-sessions/renew", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type, Authorization",
    );
  });

  it("rejects unapproved enrollment headers", async () => {
    const response = await workerFetch("/v1/relay-sessions/enroll", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization",
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: "header_not_allowed",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("POST /v1/relay-events", () => {
  it("exists as a public route and rejects an invalid body instead of returning 404", async () => {
    const response = await directWorkerFetch(
      new Request("https://relay.test/v1/relay-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      await makeRouterEnv(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "invalid_request",
      retryable: false,
    });
  });

  it("returns a durable 202 and a stable 200 acknowledgment for an identical replay", async () => {
    const testEnv = await makeRouterEnv();
    const config = await loadRelayConfig(testEnv);
    const token = generateSecureId("relay", 32);
    const nowMs = Date.now();
    await createSession(env.DB, {
      sessionId: generateSecureId("session"),
      cleanerSubject: `cehusr_v1_${"R".repeat(43)}`,
      deviceId: "device_router_123456",
      tokenHash: await hashRelayToken(token, config.relayTokenHmacKey, "test"),
      nowMs,
    });

    const inserted = await directWorkerFetch(
      eventRequest(token, EVENT_BODY, { Origin: ALLOWED_ORIGIN }),
      testEnv,
    );
    const replay = await directWorkerFetch(
      eventRequest(token, EVENT_BODY, { Origin: ALLOWED_ORIGIN }),
      testEnv,
    );
    const expectedBody = {
      ok: true,
      eventId: EVENT_BODY.eventId,
      status: "accepted",
    };

    expect(inserted.status).toBe(202);
    expect(await inserted.json()).toEqual(expectedBody);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(expectedBody);
    expect(inserted.headers.get("Cache-Control")).toBe("no-store");
    expect(inserted.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(inserted.headers.get("Access-Control-Allow-Origin")).toBe(
      ALLOWED_ORIGIN,
    );
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM relay_lanes").first<number>(
        "count",
      ),
    ).toBe(1);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM relay_events").first<number>(
        "count",
      ),
    ).toBe(1);
  });

  it("fails closed for an unknown bearer without creating event state", async () => {
    const laneCountBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM relay_lanes",
    ).first<number>("count");
    const eventCountBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM relay_events",
    ).first<number>("count");
    const response = await directWorkerFetch(
      eventRequest(generateSecureId("relay", 32)),
      await makeRouterEnv(),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "authentication_failed",
      retryable: false,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM relay_lanes").first<number>(
        "count",
      ),
    ).toBe(laneCountBefore);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM relay_events").first<number>(
        "count",
      ),
    ).toBe(eventCountBefore);
  });

  it("returns sanitized HTTP 400 for an authenticated whitespace-only property", async () => {
    const testEnv = await makeRouterEnv();
    const config = await loadRelayConfig(testEnv);
    const token = generateSecureId("relay", 32);
    const nowMs = Date.now();
    await createSession(env.DB, {
      sessionId: generateSecureId("session"),
      cleanerSubject: `cehusr_v1_${"W".repeat(43)}`,
      deviceId: "device_whitespace_123",
      tokenHash: await hashRelayToken(token, config.relayTokenHmacKey, "test"),
      nowMs,
    });
    const laneCountBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM relay_lanes",
    ).first<number>("count");
    const eventCountBefore = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM relay_events",
    ).first<number>("count");

    const response = await directWorkerFetch(
      eventRequest(token, { ...EVENT_BODY, property: " " }),
      testEnv,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "invalid_request",
      retryable: false,
    });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM relay_lanes").first<number>(
        "count",
      ),
    ).toBe(laneCountBefore);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM relay_events").first<number>(
        "count",
      ),
    ).toBe(eventCountBefore);
  });

  it("permits only the approved origin, method, and request headers", async () => {
    const preflight = await workerFetch("/v1/relay-events", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("POST");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type, Authorization",
    );
    expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBeNull();

    const unapprovedHeader = await workerFetch("/v1/relay-events", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type, X-Relay-Debug",
      },
    });
    expect(unapprovedHeader.status).toBe(403);
    expect(await unapprovedHeader.json()).toEqual({
      ok: false,
      error: "header_not_allowed",
    });

    const foreign = await workerFetch("/v1/relay-events", {
      method: "OPTIONS",
      headers: {
        Origin: FOREIGN_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
      },
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({
      ok: false,
      error: "origin_not_allowed",
    });

    const unsupported = await workerFetch("/v1/relay-events", { method: "GET" });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("Allow")).toBe("POST, OPTIONS");
  });

  it("rejects wrong content types and oversized requests before configuration access", async () => {
    const wrongType = await workerFetch("/v1/relay-events", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(EVENT_BODY),
    });
    const oversized = await workerFetch("/v1/relay-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...EVENT_BODY, note: "x".repeat(8_192) }),
    });

    for (const response of [wrongType, oversized]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        ok: false,
        error: "invalid_request",
        retryable: false,
      });
    }
  });

  it("sanitizes configuration and D1 failures as retryable 503 responses", async () => {
    const invalidConfig = await makeRouterEnv();
    invalidConfig.CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON = "{}";
    const configFailure = await directWorkerFetch(
      eventRequest(generateSecureId("relay", 32)),
      invalidConfig,
    );
    expect(configFailure.status).toBe(503);
    expect(await configFailure.json()).toEqual({
      ok: false,
      error: "temporarily_unavailable",
      retryable: true,
    });

    const unavailableDatabase = {
      prepare(): never {
        throw new Error("raw sensitive D1 failure");
      },
    } as unknown as D1Database;
    const storageFailure = await directWorkerFetch(
      eventRequest(generateSecureId("relay", 32)),
      await makeRouterEnv(unavailableDatabase),
    );
    const body = await storageFailure.text();
    expect(storageFailure.status).toBe(503);
    expect(JSON.parse(body)).toEqual({
      ok: false,
      error: "temporarily_unavailable",
      retryable: true,
    });
    expect(body).not.toContain("raw sensitive");
    expect(body).not.toContain("stack");
  });
});

describe("routing errors", () => {
  it("returns JSON for GET on an unknown route", async () => {
    const response = await workerFetch("/unknown");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("rejects unsupported methods on /health", async () => {
    const response = await workerFetch("/health", { method: "POST" });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      ok: false,
      error: "method_not_allowed",
    });
    expect(response.headers.get("Allow")).toBe("GET, OPTIONS");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
/* end[relay_worker_tests] */

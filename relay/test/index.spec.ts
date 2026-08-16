import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ALLOWED_ORIGIN, createCorsHeaders } from "../src/cors";
import { healthResponse } from "../src/health";

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

function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(`https://relay.test${path}`, init));
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

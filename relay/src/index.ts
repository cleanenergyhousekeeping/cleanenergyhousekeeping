import {
  createCorsHeaders,
  isUnauthorizedOrigin,
  preflightResponse,
  unauthorizedOriginResponse,
} from "./cors";
import { healthResponse } from "./health";
import { jsonResponse } from "./responses";
import { loadRelayConfig } from "./config";
import { DELIVERY_CRON, runDeliveryBatch } from "./delivery-service";
import {
  acceptRelayEvent,
  parseRelayEventRequest,
  type EventAcceptanceResult,
} from "./event-acceptance-service";
import { parseRelayBearerToken } from "./request-auth";
import {
  enrollRelaySession,
  renewRelaySession,
  type SessionRequestInput,
  type SessionServiceResult,
} from "./session-service";

/* begin[relay_request_router] */
const HEALTH_PATH = "/health";
const ENROLL_PATH = "/v1/relay-sessions/enroll";
const RENEW_PATH = "/v1/relay-sessions/renew";
const EVENT_PATH = "/v1/relay-events";
const MAX_SESSION_REQUEST_BYTES = 4_096;

function notFoundResponse(headers: HeadersInit): Response {
  return jsonResponse(
    {
      ok: false,
      error: "not_found",
    },
    404,
    headers,
  );
}

function methodNotAllowedResponse(
  headers: HeadersInit,
  allowedMethods: readonly string[],
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Allow", `${allowedMethods.join(", ")}, OPTIONS`);

  return jsonResponse(
    {
      ok: false,
      error: "method_not_allowed",
    },
    405,
    responseHeaders,
  );
}

function sessionStatus(result: SessionServiceResult): number {
  if (result.ok) return 200;
  if (result.error === "invalid_request") return 400;
  if (result.error === "authentication_failed") return 401;
  return 503;
}

async function parseSessionRequest(request: Request): Promise<SessionRequestInput | null> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_SESSION_REQUEST_BYTES) {
    return null;
  }
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
    return null;
  }
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_SESSION_REQUEST_BYTES) {
      return null;
    }
    const parsed = JSON.parse(rawBody) as unknown;
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      return null;
    }
    const body = parsed as Record<string, unknown>;
    if (
      Object.keys(body).sort().join("\n") !==
        ["appsSessionToken", "deviceId"].join("\n") ||
      typeof body.appsSessionToken !== "string" ||
      typeof body.deviceId !== "string"
    ) {
      return null;
    }
    return {
      appsSessionToken: body.appsSessionToken,
      deviceId: body.deviceId,
    };
  } catch (_) {
    return null;
  }
}

async function sessionResponse(
  request: Request,
  env: Env,
  path: string,
  corsHeaders: Headers,
): Promise<Response> {
  const input = await parseSessionRequest(request);
  if (input === null) {
    return jsonResponse(
      { ok: false, error: "invalid_request", retryable: false },
      400,
      corsHeaders,
    );
  }

  let config;
  try {
    config = await loadRelayConfig(env);
  } catch (_) {
    return jsonResponse(
      { ok: false, error: "temporarily_unavailable", retryable: true },
      503,
      corsHeaders,
    );
  }
  const result =
    path === ENROLL_PATH
      ? await enrollRelaySession(env.DB, config, input)
      : await renewRelaySession(
          env.DB,
          config,
          parseRelayBearerToken(request),
          input,
        );
  return jsonResponse(
    result.ok
      ? { ok: true, environment: config.environment, session: result.data }
      : result,
    path === ENROLL_PATH && result.ok ? 201 : sessionStatus(result),
    corsHeaders,
  );
}

function eventStatus(result: EventAcceptanceResult): number {
  if (result.ok) return result.outcome === "inserted" ? 202 : 200;
  if (result.error === "invalid_request") return 400;
  if (result.error === "authentication_failed") return 401;
  if (result.error === "event_conflict") return 409;
  return 503;
}

async function eventResponse(
  request: Request,
  env: Env,
  corsHeaders: Headers,
): Promise<Response> {
  const input = await parseRelayEventRequest(request);
  if (input === null) {
    return jsonResponse(
      { ok: false, error: "invalid_request", retryable: false },
      400,
      corsHeaders,
    );
  }

  let config;
  try {
    config = await loadRelayConfig(env);
  } catch (_) {
    return jsonResponse(
      { ok: false, error: "temporarily_unavailable", retryable: true },
      503,
      corsHeaders,
    );
  }
  const result = await acceptRelayEvent(
    env.DB,
    config,
    parseRelayBearerToken(request),
    input,
  );
  return jsonResponse(
    result.ok
      ? { ok: true, eventId: result.eventId, status: "accepted" }
      : result,
    eventStatus(result),
    corsHeaders,
  );
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (isUnauthorizedOrigin(origin)) {
      return unauthorizedOriginResponse();
    }

    const corsHeaders = createCorsHeaders(origin);

    const isHealth = url.pathname === HEALTH_PATH;
    const isSession = url.pathname === ENROLL_PATH || url.pathname === RENEW_PATH;
    const isEvent = url.pathname === EVENT_PATH;
    if (!isHealth && !isSession && !isEvent) {
      return notFoundResponse(corsHeaders);
    }

    if (request.method === "OPTIONS") {
      return isHealth
        ? preflightResponse(request, ["GET"])
        : preflightResponse(
            request,
            ["POST"],
            url.pathname === RENEW_PATH || isEvent
              ? ["Content-Type", "Authorization"]
              : ["Content-Type"],
          );
    }

    if (isHealth) {
      if (request.method !== "GET") {
        return methodNotAllowedResponse(corsHeaders, ["GET"]);
      }
      return healthResponse(env.DB, corsHeaders);
    }

    if (request.method !== "POST") {
      return methodNotAllowedResponse(corsHeaders, ["POST"]);
    }
    if (isEvent) {
      return eventResponse(request, env, corsHeaders);
    }
    return sessionResponse(request, env, url.pathname, corsHeaders);
  },

  scheduled(controller, env, ctx): void {
    if (controller.cron !== DELIVERY_CRON) {
      return;
    }
    ctx.waitUntil(
      (async () => {
        try {
          const config = await loadRelayConfig(env);
          const summary = await runDeliveryBatch(env.DB, config);
          console.info(JSON.stringify({ event: "relay_delivery_batch", ...summary }));
        } catch (_) {
          console.error(JSON.stringify({ event: "relay_delivery_batch_failed" }));
          throw new Error("relay_delivery_batch_failed");
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
/* end[relay_request_router] */

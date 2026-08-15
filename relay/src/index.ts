import {
  createCorsHeaders,
  isUnauthorizedOrigin,
  preflightResponse,
  unauthorizedOriginResponse,
} from "./cors";
import { healthResponse } from "./health";
import { jsonResponse } from "./responses";

/* begin[relay_request_router] */
const HEALTH_PATH = "/health";

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

function methodNotAllowedResponse(headers: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Allow", "GET, OPTIONS");

  return jsonResponse(
    {
      ok: false,
      error: "method_not_allowed",
    },
    405,
    responseHeaders,
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

    if (url.pathname !== HEALTH_PATH) {
      return notFoundResponse(corsHeaders);
    }

    if (request.method === "OPTIONS") {
      return preflightResponse(request);
    }

    if (request.method !== "GET") {
      return methodNotAllowedResponse(corsHeaders);
    }

    return healthResponse(env.DB, corsHeaders);
  },
} satisfies ExportedHandler<Env>;
/* end[relay_request_router] */

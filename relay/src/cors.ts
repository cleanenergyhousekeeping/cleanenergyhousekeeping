import { jsonResponse } from "./responses";

/* begin[relay_cors_policy] */
export const ALLOWED_ORIGIN = "https://www.cleanenergyhousekeeping.com";

export function createCorsHeaders(origin: string | null): Headers {
  const headers = new Headers({ Vary: "Origin" });

  if (origin === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  }

  return headers;
}

export function isUnauthorizedOrigin(origin: string | null): boolean {
  return origin !== null && origin !== ALLOWED_ORIGIN;
}

export function unauthorizedOriginResponse(): Response {
  return jsonResponse(
    {
      ok: false,
      error: "origin_not_allowed",
    },
    403,
    createCorsHeaders(null),
  );
}

export function preflightResponse(
  request: Request,
  allowedMethods: readonly string[] = ["GET"],
  allowedHeaders: readonly string[] = [],
): Response {
  const origin = request.headers.get("Origin");
  const requestedMethod = request.headers.get("Access-Control-Request-Method");
  const headers = createCorsHeaders(origin);

  if (origin !== ALLOWED_ORIGIN) {
    return unauthorizedOriginResponse();
  }

  if (requestedMethod === null || !allowedMethods.includes(requestedMethod)) {
    headers.set("Allow", `${allowedMethods.join(", ")}, OPTIONS`);
    return jsonResponse(
      {
        ok: false,
        error: "method_not_allowed",
      },
      405,
      headers,
    );
  }

  const requestedHeaders = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  const normalizedAllowedHeaders = allowedHeaders.map((header) => header.toLowerCase());
  if (requestedHeaders.some((header) => !normalizedAllowedHeaders.includes(header))) {
    return jsonResponse(
      { ok: false, error: "header_not_allowed" },
      403,
      headers,
    );
  }

  headers.set("Access-Control-Allow-Methods", allowedMethods.join(", "));
  if (allowedHeaders.length > 0) {
    headers.set("Access-Control-Allow-Headers", allowedHeaders.join(", "));
  }
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Cache-Control", "no-store");

  return new Response(null, { status: 204, headers });
}
/* end[relay_cors_policy] */

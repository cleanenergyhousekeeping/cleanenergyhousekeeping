/* begin[relay_request_authentication] */
const RELAY_BEARER_PATTERN = /^Bearer (relay_[A-Za-z0-9_-]{43})$/u;

export function parseRelayBearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  return RELAY_BEARER_PATTERN.exec(authorization)?.[1] ?? "";
}
/* end[relay_request_authentication] */

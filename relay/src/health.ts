import { jsonResponse } from "./responses";

/* begin[relay_health_check] */
const HEALTHY_RESPONSE = {
  ok: true,
  service: "ceh-relay",
  environment: "test",
  storage: "ok",
  version: "0.1.0",
} as const;

const UNAVAILABLE_RESPONSE = {
  ok: false,
  service: "ceh-relay",
  environment: "test",
  storage: "unavailable",
  version: "0.1.0",
} as const;

export async function isStorageReachable(database: D1Database): Promise<boolean> {
  try {
    const result = await database
      .prepare("SELECT 1 AS reachable")
      .first<{ reachable: number }>();

    return result?.reachable === 1;
  } catch {
    return false;
  }
}

export async function healthResponse(
  database: D1Database,
  headers: HeadersInit,
): Promise<Response> {
  if (await isStorageReachable(database)) {
    return jsonResponse(HEALTHY_RESPONSE, 200, headers);
  }

  return jsonResponse(UNAVAILABLE_RESPONSE, 503, headers);
}
/* end[relay_health_check] */

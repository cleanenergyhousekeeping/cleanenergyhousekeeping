import { jsonResponse } from "./responses";
import type { RelayEnvironment } from "./persistence/types";

/* begin[relay_health_check] */
const HEALTH_RESPONSE_BASE = {
  service: "ceh-relay",
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
  environment: RelayEnvironment,
  headers: HeadersInit,
): Promise<Response> {
  if (await isStorageReachable(database)) {
    return jsonResponse(
      { ...HEALTH_RESPONSE_BASE, ok: true, environment, storage: "ok" },
      200,
      headers,
    );
  }

  return jsonResponse(
    {
      ...HEALTH_RESPONSE_BASE,
      ok: false,
      environment,
      storage: "unavailable",
    },
    503,
    headers,
  );
}
/* end[relay_health_check] */

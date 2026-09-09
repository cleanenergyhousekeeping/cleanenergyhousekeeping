import { callAppsScript, type AppsCallOptions } from './apps-script-client';
import { loadRelayConfig, type RelayConfig } from './config';
import { findSiriCredential } from './persistence/siri';
import { jsonResponse } from './responses';
import { hashSiriToken, SIRI_SUBJECT_PATTERN, SIRI_TOKEN_PATTERN } from './siri-contract';

/* begin[siri_shift_status] */
function failure(error: string, status: number, headers?: HeadersInit): Response {
  return jsonResponse({ error }, status, headers);
}

export async function getSiriShiftStatus(request: Request, db: D1Database, config: RelayConfig,
  headers?: HeadersInit, options: AppsCallOptions = {}): Promise<Response> {
  if (config.environment !== 'test') return failure('not_found', 404, headers);
  const token = /^Bearer (\S+)$/u.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!SIRI_TOKEN_PATTERN.test(token)) return failure('authentication_failed', 401, headers);
  try {
    const credential = await findSiriCredential(db, await hashSiriToken(token, config), options.nowMs ?? Date.now());
    if (!credential || !SIRI_SUBJECT_PATTERN.test(credential.cleaner_subject)) {
      return failure('authentication_failed', 401, headers);
    }
    const outcome = await callAppsScript(config, 'siri_shift_status',
      { cleanerSubject: credential.cleaner_subject }, options);
    if (outcome.kind === 'result') {
      const result = outcome.response;
      if (result.ok && !result.retryable && result.operation === 'siri_shift_status' &&
          (result.result === 'active_shift' || result.result === 'no_active_shift')) {
        return jsonResponse({ state: result.result }, 200, headers);
      }
    }
    return failure('temporarily_unavailable', 503, headers);
  } catch (_) { return failure('temporarily_unavailable', 503, headers); }
}

export async function siriStatusResponse(request: Request, env: Env, headers: HeadersInit): Promise<Response> {
  if (env.CEH_RELAY_ENVIRONMENT !== 'test') return failure('not_found', 404, headers);
  try { return await getSiriShiftStatus(request, env.DB, await loadRelayConfig(env), headers); }
  catch (_) { return failure('temporarily_unavailable', 503, headers); }
}
/* end[siri_shift_status] */

import type { RelayConfig } from './config';
import { loadRelayConfig } from './config';
import { encryptJson, stringsEqualConstantTime } from './crypto';
import { jsonResponse } from './responses';
import { findSiriCredential, insertSiriRequest } from './persistence/siri';
import { digestSiriInput, hashSiriToken, siriContext, SIRI_SUBJECT_PATTERN, SIRI_TOKEN_PATTERN,
  SIRI_WAIT_MESSAGE, validateSiriInput } from './siri-contract';

/* begin[siri_durable_intake] */
const MESSAGES = { cleaning: 'Cleaning note saved', deep_clean: 'Deep clean note saved', property: 'Property note received' };

function failure(error: string, status: number, headers?: HeadersInit): Response {
  return jsonResponse({ ok: false, error, durable: status === 503 ? null : false, retryable: status === 503 }, status, headers);
}

export async function acceptSiriRequest(request: Request, db: D1Database, config: RelayConfig,
  headers?: HeadersInit, nowMs = Date.now()): Promise<Response> {
  if (config.environment !== 'test') return failure('not_found', 404, headers);
  const token = /^Bearer (\S+)$/u.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!SIRI_TOKEN_PATTERN.test(token)) return failure('authentication_failed', 401, headers);
  try {
    const credential = await findSiriCredential(db, await hashSiriToken(token, config), nowMs);
    if (!credential || !SIRI_SUBJECT_PATTERN.test(credential.cleaner_subject)) return failure('authentication_failed', 401, headers);
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
        Number(request.headers.get('Content-Length') ?? 0) > 8192) return failure('invalid_request', 400, headers);
    // Bound actual bytes, including chunked requests, before parsing or allocating an unbounded body.
    const reader = request.body?.getReader();
    if (!reader) return failure('invalid_request', 400, headers);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) { await reader.cancel(); return failure('invalid_request', 400, headers); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let input;
    try { input = validateSiriInput(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))); }
    catch (_) { return failure('invalid_request', 400, headers); }
    if (!input) return failure('invalid_request', 400, headers);
    const digest = await digestSiriInput(input, credential.cleaner_subject, config);
    const key = config.payloadEncryptionKeys.get(config.payloadActiveKeyVersion);
    if (!key) return failure('temporarily_unavailable', 503, headers);
    const encrypted = await encryptJson(input, key, config.payloadActiveKeyVersion, siriContext('payload', input.request_id));
    const { row, inserted } = await insertSiriRequest(db, credential, input.request_id, digest, encrypted, nowMs);
    if (row.cleaner_subject !== credential.cleaner_subject || !stringsEqualConstantTime(row.payload_digest, digest)) {
      return failure('request_conflict', 409, headers);
    }
    return jsonResponse({ ok: true, environment: 'test', request_id: input.request_id,
      durable: true, state: row.state, client_action: 'clear_pending',
      message: row.state === 'waiting_shift' ? SIRI_WAIT_MESSAGE : MESSAGES[input.note_type],
    }, inserted ? 202 : 200, headers);
  } catch (_) { return failure('temporarily_unavailable', 503, headers); }
}

export async function siriRequestResponse(request: Request, env: Env, headers: HeadersInit): Promise<Response> {
  if (env.CEH_RELAY_ENVIRONMENT !== 'test') return failure('not_found', 404, headers);
  try { return await acceptSiriRequest(request, env.DB, await loadRelayConfig(env), headers); }
  catch (_) { return failure('temporarily_unavailable', 503, headers); }
}
/* end[siri_durable_intake] */

import { env } from 'cloudflare:test';
import { beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { loadRelayConfig } from '../src/config';
import { bytesToBase64Url, decryptJson, generateSecureId } from '../src/crypto';
import { acceptSiriRequest } from '../src/siri-request-service';
import { hashSiriToken, siriContext, SIRI_LIFETIME_MS, SIRI_WAIT_MESSAGE } from '../src/siri-contract';
import { claimSiriLease, finishSiriAttempt, getSiriRequest } from '../src/persistence/siri';
import { runSiriDeliveryBatch } from '../src/siri-delivery-service';
import { acceptRelayEvent } from '../src/event-acceptance-service';
import type { AppsCallOutcome } from '../src/apps-script-client';

/* begin[siri_worker_tests] */
const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const SUBJECT = 'cehusr_v1_' + 'A'.repeat(43);
const input = { request_id: 'siri_request_00000001', captured_at: '2026-09-03T17:42:00.000Z', note_type: 'cleaning', note: 'Private dictated note' };
const pin = { spreadsheetId: 'test-sheet', timeSheetId: 1, propertySheetId: 2, cleanerName: 'Cleaner One', property: 'Private Property',
  clockInMs: Date.parse('2026-09-03T16:00:00.000Z'), clockOutMs: Date.parse('2026-09-03T18:00:00.000Z') };
function request(token: string, payload: unknown = input): Request {
  return new Request('https://relay.test/v1/siri-notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
}
async function fixture(subject = SUBJECT) {
  const key = bytesToBase64Url(new Uint8Array(32).fill(9));
  const runtime = { DB: env.DB, CEH_RELAY_ENVIRONMENT: 'test', CEH_RELAY_APPS_ACTIVE_KEY_ID: 'test-v1',
    CEH_RELAY_PAYLOAD_ACTIVE_KEY_VERSION: '1', CEH_RELAY_APPS_URL: 'https://script.google.test/macros/s/test/exec',
    CEH_RELAY_APPS_HMAC_KEYS_JSON: JSON.stringify({ 'test-v1': key }), CEH_RELAY_TOKEN_HMAC_KEY: key,
    CEH_RELAY_EVENT_DIGEST_HMAC_KEY: key, CEH_RELAY_PAYLOAD_ENCRYPTION_KEYS_JSON: JSON.stringify({ 1: key }) } as Env;
  const config = await loadRelayConfig(runtime);
  const token = generateSecureId('siri', 32), id = generateSecureId('siri_credential');
  await env.DB.prepare('INSERT INTO siri_credentials VALUES (?, ?, ?, ?, ?, NULL)')
    .bind(id, await hashSiriToken(token, config), subject, NOW - 1000, NOW + SIRI_LIFETIME_MS).run();
  return { runtime, config, token, id };
}
function outcome(digest: string, state: string, resolved: unknown): AppsCallOutcome {
  return { kind: 'result', response: { ok: true, operation: 'reconcile_siri_note', result: state, retryable: false,
    data: { request_id: input.request_id, payloadDigest: digest, pin: resolved } } };
}
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM siri_requests'), env.DB.prepare('DELETE FROM siri_credentials')]);
});

it('accepts while Apps is unavailable; lost-response replay returns the encrypted original request', async () => {
  const f = await fixture();
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Apps unavailable'));
  try {
    const response = await acceptSiriRequest(request(f.token), env.DB, f.config, undefined, NOW);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ durable: true, client_action: 'clear_pending', state: 'accepted', message: 'Cleaning note saved' });
    expect((await acceptSiriRequest(request(f.token), env.DB, f.config, undefined, NOW)).status).toBe(200);
    const row = (await getSiriRequest(env.DB, input.request_id))!;
    expect(await decryptJson({ ciphertext: row.payload_ciphertext, nonce: row.payload_nonce, keyVersion: row.encryption_key_version },
      f.config.payloadEncryptionKeys, siriContext('payload', input.request_id))).toEqual(input);
    for (const secret of [input.note, input.captured_at, f.token]) expect(JSON.stringify(row)).not.toContain(secret);
    expect(row.cleaner_subject).toBe(SUBJECT);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { fetchSpy.mockRestore(); }
});

it('concurrent identical submissions insert once; changed original or another cleaner conflicts without disclosure', async () => {
  const f = await fixture();
  const responses = await Promise.all(Array.from({ length: 5 }, () => acceptSiriRequest(request(f.token), env.DB, f.config, undefined, NOW)));
  expect(responses.filter(r => r.status === 202)).toHaveLength(1);
  expect(responses.filter(r => r.status === 200)).toHaveLength(4);
  for (const change of [{ note: 'changed' }, { captured_at: '2026-09-03T17:42:01.000Z' }, { note_type: 'deep_clean' }]) {
    expect((await acceptSiriRequest(request(f.token, { ...input, ...change }), env.DB, f.config, undefined, NOW)).status).toBe(409);
  }
  const other = await fixture('cehusr_v1_' + 'B'.repeat(43));
  const conflict = await acceptSiriRequest(request(other.token), env.DB, f.config, undefined, NOW);
  expect(conflict.status).toBe(409); expect(await conflict.text()).not.toContain(SUBJECT);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM siri_requests').first('n')).toBe(1);
});

it('authenticates before parsing; rejects expiry, revocation, and PWA tokens; Siri cannot clock in', async () => {
  const f = await fixture();
  for (const token of ['', 'siri_' + 'Z'.repeat(43), generateSecureId('relay', 32)]) {
    expect((await acceptSiriRequest(request(token, {}), env.DB, f.config, undefined, NOW)).status).toBe(401);
  }
  expect((await acceptSiriRequest(request(f.token), env.DB, f.config, undefined, NOW + SIRI_LIFETIME_MS)).status).toBe(401);
  await env.DB.prepare('UPDATE siri_credentials SET revoked_at_ms = ?').bind(NOW).run();
  expect((await acceptSiriRequest(request(f.token), env.DB, f.config, undefined, NOW)).status).toBe(401);
  expect(await acceptRelayEvent(env.DB, f.config, f.token, { eventId: 'event_siri_forbidden', deviceSequence: 1,
    eventType: 'clock_in', submittedAtMs: NOW, property: 'A', note: '' }, { nowMs: NOW })).toMatchObject({ error: 'authentication_failed' });
});

it('rejects invalid dates, note types, additional identity fields, blank notes, and oversized bodies', async () => {
  const f = await fixture();
  for (const change of [{ cleanerSubject: SUBJECT }, { note: ' ' }, { note: 'x'.repeat(1001) }, { note: 'x'.repeat(9000) },
    { captured_at: '2026-02-30T17:42:00.000Z' }, { captured_at: '2026-09-03T17:42:00Z' }, { note_type: 'clock_out' }]) {
    expect((await acceptSiriRequest(request(f.token, { ...input, ...change }), env.DB, f.config, undefined, NOW)).status).toBe(400);
  }
  expect(await getSiriRequest(env.DB, input.request_id)).toBeNull();
});

it('returns only fixed diagnostics for each invalid-request branch after authentication', async () => {
  const f = await fixture();
  const cases: { reason: string; body?: BodyInit; headers?: Record<string, string> }[] = [
    { reason: 'content_type_or_length', body: JSON.stringify(input), headers: { 'Content-Type': 'text/plain' } },
    { reason: 'content_type_or_length', body: JSON.stringify(input), headers: { 'Content-Length': '8193' } },
    { reason: 'missing_body' },
    { reason: 'body_over_limit', body: new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(8193)); controller.close();
    } }) },
    { reason: 'decode_or_json', body: new Uint8Array([0xff]) },
    { reason: 'decode_or_json', body: '{' },
    { reason: 'payload_validation', body: JSON.stringify({ ...input, cleanerSubject: SUBJECT }) },
  ];
  for (const testCase of cases) {
    const makeRequest = (token: string) => new Request('https://relay.test/v1/siri-notes', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...testCase.headers },
      body: testCase.body,
    });
    const unauthorized = await acceptSiriRequest(makeRequest(''), env.DB, f.config, undefined, NOW);
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ ok: false, error: 'authentication_failed', durable: false, retryable: false });
    const response = await acceptSiriRequest(makeRequest(f.token), env.DB, f.config, undefined, NOW);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'invalid_request', durable: false, retryable: false, reason: testCase.reason });
  }
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM siri_requests').first('n')).toBe(0);
  const production = await acceptSiriRequest(request(f.token, {}), env.DB,
    { ...f.config, environment: 'production' }, undefined, NOW);
  expect(production.status).toBe(404);
  expect(await production.json()).toEqual({ ok: false, error: 'not_found', durable: false, retryable: false });
});

it('routes TEST-only POST and disables Siri intake and delivery in production', async () => {
  const f = await fixture();
  expect((await worker.fetch(request(f.token) as Parameters<typeof worker.fetch>[0], f.runtime)).status).toBe(202);
  expect((await worker.fetch(request(f.token) as Parameters<typeof worker.fetch>[0],
    { ...f.runtime, CEH_RELAY_ENVIRONMENT: 'production' } as unknown as Env)).status).toBe(404);
  const callApps = vi.fn();
  await runSiriDeliveryBatch(env.DB, { ...f.config, environment: 'production' }, { callApps });
  expect(callApps).not.toHaveBeenCalled();
  expect((await worker.fetch(new Request('https://relay.test/v1/siri-notes') as Parameters<typeof worker.fetch>[0], f.runtime)).status).toBe(405);
});

it('leases serialize reconciliation, recover on expiry, and reject stale owner writes', async () => {
  const f = await fixture(); await acceptSiriRequest(request(f.token), env.DB, f.config, undefined, NOW);
  const first = (await claimSiriLease(env.DB, input.request_id, 'owner1', NOW))!;
  expect(await claimSiriLease(env.DB, input.request_id, 'owner2', NOW)).toBeNull();
  expect(await finishSiriAttempt(env.DB, first, 'owner2', NOW, 'waiting_shift', NOW, null)).toBe(false);
  expect(await claimSiriLease(env.DB, input.request_id, 'owner2', NOW + 120_001)).not.toBeNull();
  expect(await finishSiriAttempt(env.DB, first, 'owner1', NOW + 120_001, 'waiting_shift', NOW, null)).toBe(false);
});

it('waiting retries in one minute, then completion stores the encrypted pin', async () => {
  const f = await fixture(); await acceptSiriRequest(request(f.token), env.DB, f.config, undefined, NOW);
  const digest = (await getSiriRequest(env.DB, input.request_id))!.payload_digest;
  await runSiriDeliveryBatch(env.DB, f.config, { now: () => NOW, callApps: async () => outcome(digest, 'waiting_shift', null) });
  const retry = await acceptSiriRequest(request(f.token), env.DB, f.config, undefined, NOW);
  expect(await retry.json()).toMatchObject({ durable: true, state: 'waiting_shift', message: SIRI_WAIT_MESSAGE, client_action: 'clear_pending' });
  await runSiriDeliveryBatch(env.DB, f.config, { now: () => NOW + 60_000, callApps: async () => outcome(digest, 'completed', pin) });
  const row = (await getSiriRequest(env.DB, input.request_id))!;
  expect(row.state).toBe('completed'); expect(JSON.stringify(row)).not.toContain(pin.property);
  expect(await decryptJson({ ciphertext: row.pin_ciphertext!, nonce: row.pin_nonce!, keyVersion: row.pin_key_version! },
    f.config.payloadEncryptionKeys, siriContext('pin', input.request_id))).toEqual(pin);
});

it('timeout retry sends the same original and never replaces an existing pin', async () => {
  const f = await fixture(); await acceptSiriRequest(request(f.token), env.DB, f.config, undefined, NOW);
  const digest = (await getSiriRequest(env.DB, input.request_id))!.payload_digest;
  const sent: unknown[] = [];
  await runSiriDeliveryBatch(env.DB, f.config, { now: () => NOW, callApps: async (_c, _o, payload) => {
    sent.push(payload); return { kind: 'failure', category: 'timeout' };
  } });
  await runSiriDeliveryBatch(env.DB, f.config, { now: () => NOW + 60_000, callApps: async (_c, _o, payload) => {
    sent.push(payload); return outcome(digest, 'pinned', pin);
  } });
  expect(sent[0]).toEqual(sent[1]);
  await runSiriDeliveryBatch(env.DB, f.config, { now: () => NOW + 120_000, callApps: async () => outcome(digest, 'completed', { ...pin, property: 'Changed' }) });
  expect((await getSiriRequest(env.DB, input.request_id))!.state).toBe('needs_review');
});

it('corrupted payloads never reach Apps and malformed success never completes', async () => {
  const f = await fixture(); await acceptSiriRequest(request(f.token), env.DB, f.config, undefined, NOW);
  await runSiriDeliveryBatch(env.DB, f.config, { now: () => NOW, callApps: async () => outcome('wrong', 'completed', pin) });
  expect((await getSiriRequest(env.DB, input.request_id))!.state).toBe('accepted');
  await env.DB.prepare("UPDATE siri_requests SET payload_digest = 'corrupt'").run();
  const callApps = vi.fn();
  await runSiriDeliveryBatch(env.DB, f.config, { now: () => NOW + 60_000, callApps });
  expect(callApps).not.toHaveBeenCalled();
  expect((await getSiriRequest(env.DB, input.request_id))!.state).toBe('needs_review');
});
/* end[siri_worker_tests] */

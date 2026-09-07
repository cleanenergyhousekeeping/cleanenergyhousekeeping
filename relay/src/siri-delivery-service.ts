import { callAppsScript } from './apps-script-client';
import type { RelayConfig } from './config';
import { decryptJson, encryptJson, generateSecureId, stringsEqualConstantTime } from './crypto';
import { claimSiriLease, finishSiriAttempt, listDueSiriRequests, type SiriRequestRow } from './persistence/siri';
import { digestSiriInput, digestSiriPin, siriContext, validateSiriInput, validateSiriPin, type SiriState } from './siri-contract';

/* begin[siri_reconciliation_delivery] */
interface Dependencies { callApps?: typeof callAppsScript; now?: () => number }

async function deliverSiriRequest(db: D1Database, config: RelayConfig, candidate: SiriRequestRow,
  dependencies: Dependencies): Promise<void> {
  const now = dependencies.now ?? Date.now;
  const owner = generateSecureId('siri_lease');
  const row = await claimSiriLease(db, candidate.request_id, owner, now());
  if (!row) return;
  const retry = (reason: string, delay = 60_000) => finishSiriAttempt(db, row, owner, now(), row.state,
    now() + delay, reason);
  try {
    let input;
    try {
      input = validateSiriInput(await decryptJson({ ciphertext: row.payload_ciphertext,
        nonce: row.payload_nonce, keyVersion: row.encryption_key_version }, config.payloadEncryptionKeys,
        siriContext('payload', row.request_id)));
      if (!input || input.request_id !== row.request_id ||
          !stringsEqualConstantTime(await digestSiriInput(input, row.cleaner_subject, config), row.payload_digest)) throw new Error();
    } catch (_) {
      await finishSiriAttempt(db, row, owner, now(), 'needs_review', now(), 'payload_integrity');
      return;
    }
    if (row.pin_digest) {
      try {
        const prior = validateSiriPin(await decryptJson({ ciphertext: row.pin_ciphertext!,
          nonce: row.pin_nonce!, keyVersion: row.pin_key_version! }, config.payloadEncryptionKeys,
          siriContext('pin', row.request_id)), input);
        if (!prior || !stringsEqualConstantTime(await digestSiriPin(prior, config), row.pin_digest)) throw new Error();
      } catch (_) {
        await finishSiriAttempt(db, row, owner, now(), 'needs_review', now(), 'pin_integrity');
        return;
      }
    }
    const outcome = await (dependencies.callApps ?? callAppsScript)(config, 'reconcile_siri_note', {
      ...input, cleanerSubject: row.cleaner_subject, payloadDigest: row.payload_digest,
    }, { nowMs: now() });
    if (outcome.kind === 'failure') {
      await retry(outcome.category, Math.max(60_000, outcome.retryAfterMs ?? 0));
      return;
    }
    const response = outcome.response;
    const data = response.data as Record<string, unknown> | undefined;
    const states: SiriState[] = ['waiting_shift', 'pinned', 'completed', 'needs_review'];
    if (response.operation !== 'reconcile_siri_note' || !response.ok || response.retryable ||
        !states.includes(response.result as SiriState) || !data || Array.isArray(data) ||
        data.request_id !== row.request_id || data.payloadDigest !== row.payload_digest ||
        Object.keys(data).sort().join(',') !== 'payloadDigest,pin,request_id') {
      await retry('apps_protocol_or_unavailable');
      return;
    }
    const state = response.result as SiriState;
    const pin = data.pin === null ? null : validateSiriPin(data.pin, input);
    if ((data.pin !== null && !pin) || (['pinned', 'completed'].includes(state) && !pin) ||
        (row.pin_digest && !pin) || (state === 'waiting_shift' && pin)) {
      await retry('apps_protocol_or_unavailable');
      return;
    }
    let storedPin;
    if (pin) {
      const digest = await digestSiriPin(pin, config);
      if (row.pin_digest && !stringsEqualConstantTime(row.pin_digest, digest)) {
        await finishSiriAttempt(db, row, owner, now(), 'needs_review', now(), 'pin_conflict');
        return;
      }
      const key = config.payloadEncryptionKeys.get(config.payloadActiveKeyVersion);
      if (!key) { await retry('encryption_unavailable'); return; }
      storedPin = { digest, encrypted: await encryptJson(pin, key, config.payloadActiveKeyVersion,
        siriContext('pin', row.request_id)) };
    }
    await finishSiriAttempt(db, row, owner, now(), state, now() + (state === 'waiting_shift' && row.attempt_count >= 5 ? 300_000 : 60_000),
      state === 'needs_review' ? 'apps_review_required' : null, storedPin);
  } catch (_) {
    // A failed final D1 write leaves a recoverable lease and an idempotent Apps ledger.
    await retry('temporarily_unavailable');
  }
}

export async function runSiriDeliveryBatch(db: D1Database, config: RelayConfig,
  dependencies: Dependencies = {}): Promise<void> {
  if (config.environment !== 'test') return;
  const rows = await listDueSiriRequests(db, (dependencies.now ?? Date.now)());
  for (const row of rows) {
    try { await deliverSiriRequest(db, config, row, dependencies); }
    catch (_) { /* The bounded lease recovers storage failures on a later run. */ }
  }
}
/* end[siri_reconciliation_delivery] */

import type { EncryptedValue } from './types';
import type { SiriState } from '../siri-contract';

/* begin[siri_repository] */
export interface SiriCredential {
  credential_id: string;
  cleaner_subject: string;
}
export interface SiriRequestRow {
  request_id: string;
  credential_id: string;
  cleaner_subject: string;
  payload_digest: string;
  payload_ciphertext: string;
  payload_nonce: string;
  encryption_key_version: number;
  state: SiriState;
  pin_digest: string | null;
  pin_ciphertext: string | null;
  pin_nonce: string | null;
  pin_key_version: number | null;
  attempt_count: number;
  accepted_at_ms: number;
  next_attempt_at_ms: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  failure_code: string | null;
}

export function findSiriCredential(db: D1Database, hash: string, nowMs: number): Promise<SiriCredential | null> {
  return db.prepare(`SELECT credential_id, cleaner_subject FROM siri_credentials
    WHERE token_hash = ? AND revoked_at_ms IS NULL AND issued_at_ms <= ? AND expires_at_ms > ?`)
    .bind(hash, nowMs, nowMs).first<SiriCredential>();
}

export function getSiriRequest(db: D1Database, id: string): Promise<SiriRequestRow | null> {
  return db.prepare('SELECT * FROM siri_requests WHERE request_id = ?').bind(id).first<SiriRequestRow>();
}

export async function insertSiriRequest(db: D1Database, credential: SiriCredential, id: string,
  digest: string, encrypted: EncryptedValue, nowMs: number): Promise<{ inserted: boolean; row: SiriRequestRow }> {
  // Recheck revocation/expiry in the insertion statement to close the auth/write race.
  const result = await db.prepare(`INSERT INTO siri_requests (
    request_id, credential_id, cleaner_subject, payload_digest, payload_ciphertext, payload_nonce,
    encryption_key_version, accepted_at_ms, updated_at_ms, next_attempt_at_ms)
    SELECT ?, credential_id, cleaner_subject, ?, ?, ?, ?, ?, ?, ? FROM siri_credentials
    WHERE credential_id = ? AND revoked_at_ms IS NULL AND issued_at_ms <= ? AND expires_at_ms > ?
    ON CONFLICT(request_id) DO NOTHING`)
    .bind(id, digest, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, nowMs, nowMs, nowMs,
      credential.credential_id, nowMs, nowMs).run();
  const row = await getSiriRequest(db, id);
  if (!row) throw new Error('Siri request not stored');
  return { inserted: result.meta.changes === 1, row };
}

export async function listDueSiriRequests(db: D1Database, nowMs: number): Promise<SiriRequestRow[]> {
  return (await db.prepare(`SELECT * FROM siri_requests
    WHERE state IN ('accepted', 'waiting_shift', 'pinned') AND next_attempt_at_ms <= ?
      AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)
    ORDER BY next_attempt_at_ms, accepted_at_ms, request_id LIMIT 10`).bind(nowMs, nowMs).all<SiriRequestRow>()).results;
}

export function claimSiriLease(db: D1Database, id: string, owner: string, nowMs: number): Promise<SiriRequestRow | null> {
  return db.prepare(`UPDATE siri_requests SET lease_owner = ?, lease_expires_at_ms = ?,
    attempt_count = attempt_count + 1, updated_at_ms = ?
    WHERE request_id = ? AND state IN ('accepted', 'waiting_shift', 'pinned') AND next_attempt_at_ms <= ?
      AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?) RETURNING *`)
    .bind(owner, nowMs + 120_000, nowMs, id, nowMs, nowMs).first<SiriRequestRow>();
}

export async function finishSiriAttempt(db: D1Database, row: SiriRequestRow, owner: string, nowMs: number,
  state: SiriState, nextMs: number, failure: string | null,
  pin?: { digest: string; encrypted: EncryptedValue }): Promise<boolean> {
  const result = await db.prepare(`UPDATE siri_requests SET state = ?, next_attempt_at_ms = ?, failure_code = ?,
    pin_digest = COALESCE(pin_digest, ?), pin_ciphertext = COALESCE(pin_ciphertext, ?),
    pin_nonce = COALESCE(pin_nonce, ?), pin_key_version = COALESCE(pin_key_version, ?),
    completed_at_ms = CASE WHEN ? = 'completed' THEN ? ELSE completed_at_ms END,
    updated_at_ms = ?, lease_owner = NULL, lease_expires_at_ms = NULL
    WHERE request_id = ? AND lease_owner = ? AND lease_expires_at_ms > ?
      AND (pin_digest IS NULL OR ? IS NULL OR pin_digest = ?)`)
    .bind(state, nextMs, failure, pin?.digest ?? null, pin?.encrypted.ciphertext ?? null,
      pin?.encrypted.nonce ?? null, pin?.encrypted.keyVersion ?? null, state, nowMs, nowMs,
      row.request_id, owner, nowMs, pin?.digest ?? null, pin?.digest ?? null).run();
  return result.meta.changes === 1;
}
/* end[siri_repository] */

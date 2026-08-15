import type { EncryptedValue } from "./types";

/* begin[relay_retention_repository] */
export const DELIVERED_PAYLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const MINIMAL_METADATA_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;

export async function redactDeliveredEventPayloads(
  db: D1Database,
  nowMs: number,
): Promise<number> {
  const cutoffMs = nowMs - DELIVERED_PAYLOAD_RETENTION_MS;
  const result = await db
    .prepare(
      `UPDATE relay_events
       SET payload_ciphertext = NULL, payload_nonce = NULL,
           encryption_key_version = NULL, payload_redacted_at_ms = ?,
           updated_at_ms = ?
       WHERE state = 'delivered'
         AND delivered_at_ms <= ?
         AND payload_redacted_at_ms IS NULL`,
    )
    .bind(nowMs, nowMs, cutoffMs)
    .run();
  return result.meta.changes ?? 0;
}

export async function deleteExpiredEventMetadata(
  db: D1Database,
  nowMs: number,
): Promise<number> {
  const cutoffMs = nowMs - MINIMAL_METADATA_RETENTION_MS;
  const result = await db
    .prepare(
      `DELETE FROM relay_events
       WHERE state = 'delivered'
         AND delivered_at_ms <= ?
         AND payload_redacted_at_ms IS NOT NULL`,
    )
    .bind(cutoffMs)
    .run();
  return result.meta.changes ?? 0;
}

export async function deleteExpiredIncidentHistory(
  db: D1Database,
  nowMs: number,
): Promise<number> {
  const cutoffMs = nowMs - MINIMAL_METADATA_RETENTION_MS;
  const result = await db
    .prepare(
      `DELETE FROM notification_incidents
       WHERE status = 'recovered' AND recovered_at_ms <= ?`,
    )
    .bind(cutoffMs)
    .run();
  return result.meta.changes ?? 0;
}

export async function deleteExpiredStateSnapshots(
  db: D1Database,
  nowMs: number,
): Promise<number> {
  const result = await db
    .prepare("DELETE FROM relay_state_snapshots WHERE expires_at_ms <= ?")
    .bind(nowMs)
    .run();
  return result.meta.changes ?? 0;
}

export async function saveEncryptedStateSnapshot(
  db: D1Database,
  input: {
    cleanerSubject: string;
    encryptedState: EncryptedValue;
    sourceUpdatedAtMs: number;
    ledgerHighWaterMark?: string;
    expiresAtMs: number;
    nowMs: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO relay_state_snapshots (
         cleaner_subject, state_ciphertext, state_nonce, encryption_key_version,
         source_updated_at_ms, ledger_high_water_mark, expires_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cleaner_subject) DO UPDATE SET
         state_ciphertext = excluded.state_ciphertext,
         state_nonce = excluded.state_nonce,
         encryption_key_version = excluded.encryption_key_version,
         source_updated_at_ms = excluded.source_updated_at_ms,
         ledger_high_water_mark = excluded.ledger_high_water_mark,
         expires_at_ms = excluded.expires_at_ms,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .bind(
      input.cleanerSubject,
      input.encryptedState.ciphertext,
      input.encryptedState.nonce,
      input.encryptedState.keyVersion,
      input.sourceUpdatedAtMs,
      input.ledgerHighWaterMark ?? null,
      input.expiresAtMs,
      input.nowMs,
    )
    .run();
}
/* end[relay_retention_repository] */

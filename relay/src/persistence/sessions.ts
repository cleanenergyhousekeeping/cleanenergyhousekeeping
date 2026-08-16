import type { RelaySessionRow } from "./types";

/* begin[relay_session_repository] */
export const RELAY_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
export const RELAY_TOKEN_ROTATION_OVERLAP_MS = 10 * 60 * 1_000;
export const SESSION_CLEANUP_GRACE_MS = 30 * 24 * 60 * 60 * 1_000;

export interface CreateSessionInput {
  sessionId: string;
  cleanerSubject: string;
  deviceId: string;
  tokenHash: string;
  nowMs: number;
}

export async function createSession(
  db: D1Database,
  input: CreateSessionInput,
): Promise<RelaySessionRow> {
  const expiresAtMs = input.nowMs + RELAY_TOKEN_LIFETIME_MS;
  await db.batch([
    db
      .prepare(
        `UPDATE relay_sessions
         SET status = 'revoked', revoked_at_ms = ?, updated_at_ms = ?
         WHERE cleaner_subject = ? AND status = 'active'`,
      )
      .bind(input.nowMs, input.nowMs, input.cleanerSubject),
    db
      .prepare(
        `INSERT INTO relay_sessions (
           session_id, cleaner_subject, device_id, status, created_at_ms,
           last_validated_at_ms, expires_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
      )
      .bind(
        input.sessionId,
        input.cleanerSubject,
        input.deviceId,
        input.nowMs,
        input.nowMs,
        expiresAtMs,
        input.nowMs,
      ),
    db
      .prepare(
        `INSERT INTO relay_session_tokens (
           token_hash, session_id, issued_at_ms, expires_at_ms
         ) VALUES (?, ?, ?, ?)`,
      )
      .bind(input.tokenHash, input.sessionId, input.nowMs, expiresAtMs),
  ]);

  return getSession(db, input.sessionId);
}

export async function rotateSessionToken(
  db: D1Database,
  sessionId: string,
  nextTokenHash: string,
  nowMs: number,
): Promise<boolean> {
  const overlapEndsAtMs = nowMs + RELAY_TOKEN_ROTATION_OVERLAP_MS;
  const nextExpiresAtMs = nowMs + RELAY_TOKEN_LIFETIME_MS;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO relay_session_tokens (
           token_hash, session_id, issued_at_ms, expires_at_ms
         )
         SELECT ?, session_id, ?, ?
         FROM relay_sessions
         WHERE session_id = ? AND status = 'active' AND expires_at_ms > ?`,
      )
      .bind(
        nextTokenHash,
        nowMs,
        nextExpiresAtMs,
        sessionId,
        nowMs,
      ),
    db
      .prepare(
        `UPDATE relay_session_tokens
         SET rotated_at_ms = COALESCE(rotated_at_ms, ?),
             expires_at_ms = MIN(expires_at_ms, ?)
         WHERE session_id = ? AND token_hash != ? AND expires_at_ms > ?
           AND EXISTS (
             SELECT 1 FROM relay_session_tokens
             WHERE token_hash = ? AND session_id = ?
           )`,
      )
      .bind(
        nowMs,
        overlapEndsAtMs,
        sessionId,
        nextTokenHash,
        nowMs,
        nextTokenHash,
        sessionId,
      ),
    db
      .prepare(
        `UPDATE relay_sessions
         SET last_validated_at_ms = ?, expires_at_ms = ?, updated_at_ms = ?
         WHERE session_id = ? AND status = 'active' AND expires_at_ms > ?
           AND EXISTS (
             SELECT 1 FROM relay_session_tokens
             WHERE token_hash = ? AND session_id = ?
           )`,
      )
      .bind(
        nowMs,
        nextExpiresAtMs,
        nowMs,
        sessionId,
        nowMs,
        nextTokenHash,
        sessionId,
      ),
  ]);

  return (results[0].meta.changes ?? 0) === 1;
}

export async function revokeSession(
  db: D1Database,
  sessionId: string,
  nowMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE relay_sessions
       SET status = 'revoked', revoked_at_ms = ?, updated_at_ms = ?
       WHERE session_id = ? AND status = 'active'`,
    )
    .bind(nowMs, nowMs, sessionId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function expireSessions(
  db: D1Database,
  nowMs: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE relay_sessions
       SET status = 'expired', updated_at_ms = ?
       WHERE status = 'active' AND expires_at_ms <= ?`,
    )
    .bind(nowMs, nowMs)
    .run();
  return result.meta.changes ?? 0;
}

export async function findActiveSessionByTokenHash(
  db: D1Database,
  tokenHash: string,
  nowMs: number,
): Promise<RelaySessionRow | null> {
  return db
    .prepare(
      `SELECT sessions.*
       FROM relay_session_tokens AS tokens
       JOIN relay_sessions AS sessions ON sessions.session_id = tokens.session_id
       WHERE tokens.token_hash = ?
         AND tokens.expires_at_ms > ?
         AND sessions.status = 'active'
         AND sessions.expires_at_ms > ?`,
    )
    .bind(tokenHash, nowMs, nowMs)
    .first<RelaySessionRow>();
}

export async function cleanupExpiredSessions(
  db: D1Database,
  nowMs: number,
): Promise<number> {
  const cutoffMs = nowMs - SESSION_CLEANUP_GRACE_MS;
  const result = await db
    .prepare(
      `DELETE FROM relay_sessions
       WHERE (status = 'revoked' AND revoked_at_ms <= ?)
          OR (expires_at_ms <= ?)`,
    )
    .bind(cutoffMs, cutoffMs)
    .run();
  return result.meta.changes ?? 0;
}

export async function getSession(
  db: D1Database,
  sessionId: string,
): Promise<RelaySessionRow> {
  const session = await db
    .prepare("SELECT * FROM relay_sessions WHERE session_id = ?")
    .bind(sessionId)
    .first<RelaySessionRow>();
  if (session === null) {
    throw new Error("Relay session was not found");
  }
  return session;
}
/* end[relay_session_repository] */

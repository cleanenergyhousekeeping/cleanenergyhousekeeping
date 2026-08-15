/* begin[relay_notification_repository] */
export type IncidentCategory =
  | "terminal_business_rejection"
  | "corrupted_event"
  | "apps_google_outage"
  | "authentication_failure"
  | "stalled_backlog"
  | "unresolved_event";

export interface NotificationIncidentRow {
  incident_id: string;
  incident_key: string;
  category: IncidentCategory;
  scope_hash: string;
  status: "open" | "recovered";
  opened_at_ms: number;
  updated_at_ms: number;
  cooldown_until_ms: number | null;
  recovered_at_ms: number | null;
}

export async function getOrCreateIncident(
  db: D1Database,
  input: {
    incidentId: string;
    incidentKey: string;
    category: IncidentCategory;
    scopeHash: string;
    nowMs: number;
    cooldownUntilMs?: number;
  },
): Promise<NotificationIncidentRow> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO notification_incidents (
         incident_id, incident_key, category, scope_hash, status,
         opened_at_ms, updated_at_ms, cooldown_until_ms
       ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
    .bind(
      input.incidentId,
      input.incidentKey,
      input.category,
      input.scopeHash,
      input.nowMs,
      input.nowMs,
      input.cooldownUntilMs ?? null,
    )
    .run();

  const incident = await db
    .prepare("SELECT * FROM notification_incidents WHERE incident_key = ?")
    .bind(input.incidentKey)
    .first<NotificationIncidentRow>();
  if (incident === null) {
    throw new Error("Notification incident could not be created");
  }
  return incident;
}

export async function addIncidentEvent(
  db: D1Database,
  incidentId: string,
  eventId: string,
  nowMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO incident_event_membership (
         incident_id, event_id, added_at_ms
       ) VALUES (?, ?, ?)`,
    )
    .bind(incidentId, eventId, nowMs)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function enqueueIncidentNotification(
  db: D1Database,
  input: {
    notificationId: string;
    incidentId: string;
    dedupeKey: string;
    transitionType: "opened" | "escalated" | "recovered";
    availableAtMs: number;
    nowMs: number;
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO notification_outbox (
         notification_id, incident_id, dedupe_key, transition_type, status,
         available_at_ms, created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(
      input.notificationId,
      input.incidentId,
      input.dedupeKey,
      input.transitionType,
      input.availableAtMs,
      input.nowMs,
      input.nowMs,
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function recoverIncident(
  db: D1Database,
  incidentId: string,
  nowMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE notification_incidents
       SET status = 'recovered', recovered_at_ms = ?, updated_at_ms = ?
       WHERE incident_id = ? AND status = 'open'`,
    )
    .bind(nowMs, nowMs, incidentId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}
/* end[relay_notification_repository] */

import type { Database } from "../../../db/pool.js";

export async function enqueueCountryNotification(
  db: Database,
  input: { userId: string; notificationType: string; payload: Record<string, unknown>; dedupeKey?: string }
): Promise<void> {
  await db.query(
    `INSERT INTO countrylinqa_notification_outbox (user_id, notification_type, payload, dedupe_key)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [input.userId, input.notificationType, JSON.stringify(input.payload), input.dedupeKey ?? null]
  );
}

export async function claimNotificationBatch(db: Database, limit = 100) {
  const result = await db.query(
    `UPDATE countrylinqa_notification_outbox
     SET status = 'PROCESSING', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM countrylinqa_notification_outbox
       WHERE status = 'PENDING' AND available_at <= now()
       ORDER BY available_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     RETURNING *`,
    [limit]
  );
  return result.rows;
}

export async function markNotificationSent(db: Database, id: string): Promise<void> {
  await db.query(
    `UPDATE countrylinqa_notification_outbox SET status = 'SENT', sent_at = now() WHERE id = $1`,
    [id]
  );
}

export async function markNotificationFailed(db: Database, id: string, error: string): Promise<void> {
  const truncated = error.slice(0, 500);
  await db.query(
    `UPDATE countrylinqa_notification_outbox
     SET status = CASE WHEN attempts >= 5 THEN 'FAILED' ELSE 'PENDING' END,
         available_at = now() + interval '5 minutes',
         payload = payload || jsonb_build_object('lastError', $2::text)
     WHERE id = $1`,
    [id, truncated]
  );
}

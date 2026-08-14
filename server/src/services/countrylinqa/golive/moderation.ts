import type { Database } from "../../../db/pool.js";

export async function enqueueModeration(
  db: Database,
  input: {
    subjectType: string;
    subjectId: string;
    countryCode?: string | null;
    regionCode?: string | null;
    reasonCode: string;
    priority?: number;
    evidence?: Record<string, unknown>;
  }
): Promise<string> {
  const result = await db.query(
    `INSERT INTO countrylinqa_moderation_queue
       (subject_type, subject_id, country_code, region_code, reason_code, priority, evidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      input.subjectType,
      input.subjectId,
      input.countryCode ?? null,
      input.regionCode ?? null,
      input.reasonCode,
      input.priority ?? 50,
      JSON.stringify(input.evidence ?? {})
    ]
  );
  return result.rows[0].id;
}

export async function claimModerationItem(db: Database, staffUserId: string) {
  const result = await db.query(
    `UPDATE countrylinqa_moderation_queue
     SET status = 'ASSIGNED', assigned_to = $1, updated_at = now()
     WHERE id = (
       SELECT id FROM countrylinqa_moderation_queue
       WHERE status = 'OPEN'
       ORDER BY priority DESC, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
    [staffUserId]
  );
  return result.rows[0] ?? null;
}

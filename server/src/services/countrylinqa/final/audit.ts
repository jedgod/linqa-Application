import type { Database } from "../../../db/pool.js";

export async function auditCountryLinqa(
  db: Database,
  input: {
    userId: string;
    actorUserId?: string | null;
    eventType: string;
    oldValue?: unknown;
    newValue?: unknown;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO countrylinqa_user_audit (user_id, actor_user_id, event_type, old_value, new_value, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.userId,
      input.actorUserId ?? null,
      input.eventType,
      input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
      input.newValue === undefined ? null : JSON.stringify(input.newValue),
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

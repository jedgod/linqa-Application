import type { Database } from "../../../db/pool.js";

export async function hasActivePolicyAction(db: Database, userId: string, actionType: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM countrylinqa_policy_actions
     WHERE user_id = $1 AND action_type = $2 AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [userId, actionType]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function applyPolicyAction(
  db: Database,
  input: { userId: string; actionType: string; sourceEventId?: string; details?: Record<string, unknown>; expiresAt?: Date }
): Promise<void> {
  await db.query(
    `INSERT INTO countrylinqa_policy_actions (user_id, action_type, source_event_id, details, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.userId, input.actionType, input.sourceEventId ?? null, JSON.stringify(input.details ?? {}), input.expiresAt ?? null]
  );
}

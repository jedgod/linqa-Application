import type { Database } from "../../db/pool.js";

/** Lock the owner before counting and creating: concurrent writers share the same cap. */
export async function limitedOwnedWrite(db: Database, userId: string, table: "contact_requests" | "countrylinqa_saved_searches", sql: string, params: unknown[]) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (!owner.rowCount) throw new Error("Owner unavailable");
    const where = table === "contact_requests" ? "sender_user_id=$1 AND status='PENDING' AND expires_at>now()" : "user_id=$1 AND enabled=TRUE";
    const count = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`, [userId]);
    const existing = table === "contact_requests" ? await client.query("SELECT id FROM contact_requests WHERE sender_user_id=$1 AND recipient_user_id=$2 AND (status='ACCEPTED' OR (status='PENDING' AND expires_at>now()))", [userId, params[1]]) : null;
    if (Number(count.rows[0]?.count) >= 50 && !existing?.rowCount) throw Object.assign(new Error("Resource limit reached"), { status: 409, code: "RESOURCE_LIMIT_REACHED" });
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";

const config = loadConfig();
const db = createPool(config);

async function deleteUser(userId: string): Promise<void> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const job = await client.query(
      `SELECT id
       FROM account_deletion_jobs
       WHERE user_id = $1
         AND status IN ('RUNNING', 'RETRY')
       FOR UPDATE`,
      [userId]
    );
    if (job.rowCount !== 1) throw new Error("deletion job unavailable");

    const hold = await client.query(
      `SELECT 1
       FROM retention_overrides
       WHERE released_at IS NULL
         AND resource_type = 'USER'
         AND resource_id = $1
         AND (expires_at IS NULL OR expires_at > now())`,
      [userId]
    );

    if (hold.rowCount) {
      await client.query(
        `UPDATE account_deletion_jobs
         SET status = 'BLOCKED',
             last_error = 'ACTIVE_RETENTION_OVERRIDE',
             updated_at = now()
         WHERE user_id = $1`,
        [userId]
      );
      await client.query("COMMIT");
      return;
    }

    await client.query(
      `UPDATE users SET deletion_status = 'DELETING' WHERE id = $1`,
      [userId]
    );

    await client.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM passkey_credentials WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM account_identifiers WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM security_notifications WHERE user_id = $1`, [userId]);

    await client.query(
      `UPDATE devices
       SET status = 'REVOKED', revoked_at = COALESCE(revoked_at, now())
       WHERE user_id = $1`,
      [userId]
    );

    await client.query(
      `UPDATE users
       SET external_subject = 'deleted:' || id::text,
           deletion_status = 'DELETED',
           deletion_execute_at = NULL,
           updated_at = now()
       WHERE id = $1`,
      [userId]
    );

    await client.query(
      `UPDATE account_deletion_jobs
       SET status = 'COMPLETED',
           completed_at = now(),
           updated_at = now()
       WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await db.query(
      `UPDATE account_deletion_jobs
       SET status = 'RETRY',
           attempts = attempts + 1,
           last_error = $2,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, error instanceof Error ? error.message : "unknown"]
    );
  } finally {
    client.release();
  }
}

try {
  const due = await db.query(
    `UPDATE account_deletion_jobs
     SET status = 'RUNNING',
         locked_at = now(),
         updated_at = now()
     WHERE id IN (
       SELECT id
       FROM account_deletion_jobs
       WHERE status IN ('SCHEDULED', 'RETRY')
         AND execute_at <= now()
       ORDER BY execute_at
       FOR UPDATE SKIP LOCKED
       LIMIT 25
     )
     RETURNING user_id`
  );

  for (const row of due.rows) {
    await deleteUser(row.user_id);
  }
} finally {
  await db.end();
}

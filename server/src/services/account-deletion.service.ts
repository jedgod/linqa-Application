import type { Database } from "../db/pool.js";

export class AccountDeletionService {
  constructor(private readonly db: Database) {}

  async schedule(input: {
    userId: string;
    delayDays: number;
  }) {
    if (![7, 14, 30].includes(input.delayDays)) {
      throw new Error("invalid deletion delay");
    }

    const executeAt = new Date(Date.now() + input.delayDays * 24 * 60 * 60 * 1000);
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE users
         SET deletion_status = 'PENDING_DELETION',
             deletion_requested_at = now(),
             deletion_execute_at = $2,
             deletion_cancelled_at = NULL
         WHERE id = $1
           AND deletion_status IN ('ACTIVE', 'RECOVERY_HOLD')`,
        [input.userId, executeAt]
      );

      await client.query(
        `INSERT INTO account_deletion_jobs (user_id, status, execute_at)
         VALUES ($1, 'SCHEDULED', $2)
         ON CONFLICT (user_id)
         DO UPDATE SET
           status = 'SCHEDULED',
           execute_at = EXCLUDED.execute_at,
           attempts = 0,
           last_error = NULL,
           updated_at = now()`,
        [input.userId, executeAt]
      );

      await client.query(
        `UPDATE auth_sessions
         SET revoked_at = now(),
             revoke_reason = 'ACCOUNT_PENDING_DELETION'
         WHERE user_id = $1
           AND revoked_at IS NULL`,
        [input.userId]
      );

      await client.query("COMMIT");
      return { executeAt };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancel(userId: string): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const user = await client.query(
        `SELECT deletion_status, deletion_execute_at
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [userId]
      );

      if (user.rows[0]?.deletion_status !== "PENDING_DELETION") {
        throw new Error("deletion is not cancellable");
      }

      await client.query(
        `UPDATE users
         SET deletion_status = 'ACTIVE',
             deletion_cancelled_at = now(),
             deletion_execute_at = NULL
         WHERE id = $1`,
        [userId]
      );

      await client.query(
        `UPDATE account_deletion_jobs
         SET status = 'CANCELLED',
             updated_at = now()
         WHERE user_id = $1
           AND status IN ('SCHEDULED', 'RETRY')`,
        [userId]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

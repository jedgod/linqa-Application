import type { Database } from "../db/pool.js";

export class EntitlementService {
  constructor(private readonly db: Database) {}

  async has(userId: string, entitlementKey: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT enabled
       FROM entitlements
       WHERE user_id = $1
         AND entitlement_key = $2
         AND enabled = TRUE
         AND (expires_at IS NULL OR expires_at > now())`,
      [userId, entitlementKey]
    );
    return result.rowCount === 1;
  }

  async list(userId: string) {
    const result = await this.db.query(
      `SELECT entitlement_key, enabled, source, expires_at
       FROM entitlements
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows;
  }

  async applyWebhook(input: {
    eventId: string;
    provider: string;
    payloadHash: Buffer;
    userId: string;
    planCode: string;
    status: "FREE" | "TRIAL" | "ACTIVE" | "GRACE" | "PAST_DUE" | "CANCELLED" | "EXPIRED";
    entitlements: string[];
    periodEnd?: Date;
  }) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const inserted = await client.query(
        `INSERT INTO billing_webhook_events (
           id, provider, payload_hash, status
         ) VALUES ($1,$2,$3,'RECEIVED')
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [input.eventId, input.provider, input.payloadHash]
      );

      if (inserted.rowCount !== 1) {
        await client.query("ROLLBACK");
        return { duplicate: true };
      }

      await client.query(
        `INSERT INTO subscription_accounts (
           user_id, provider, status, plan_code, current_period_end
         ) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id)
         DO UPDATE SET
           provider = EXCLUDED.provider,
           status = EXCLUDED.status,
           plan_code = EXCLUDED.plan_code,
           current_period_end = EXCLUDED.current_period_end,
           updated_at = now()`,
        [
          input.userId,
          input.provider,
          input.status,
          input.planCode,
          input.periodEnd ?? null
        ]
      );

      await client.query(`DELETE FROM entitlements WHERE user_id = $1`, [input.userId]);

      for (const entitlement of input.entitlements) {
        await client.query(
          `INSERT INTO entitlements (
             user_id, entitlement_key, enabled, source, expires_at
           ) VALUES ($1,$2,TRUE,$3,$4)`,
          [
            input.userId,
            entitlement,
            input.provider,
            input.periodEnd ?? null
          ]
        );
      }

      await client.query(
        `UPDATE billing_webhook_events
         SET status = 'PROCESSED', processed_at = now()
         WHERE id = $1`,
        [input.eventId]
      );

      await client.query("COMMIT");
      return { duplicate: false };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

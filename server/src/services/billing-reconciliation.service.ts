import { createHash, timingSafeEqual } from "node:crypto";
import type { Database } from "../db/pool.js";

export interface BillingWebhookVerifier {
  verify(input: { rawBody: Buffer; signature: string }): Promise<{
    id: string;
    type: string;
    userId?: string;
    entitlementKey?: string;
    active?: boolean;
    expiresAt?: Date;
  }>;
}

/** No billing provider webhook secret is configured in this environment. */
export class FailClosedBillingWebhookVerifier implements BillingWebhookVerifier {
  async verify(): Promise<never> {
    throw new Error("Billing webhook verifier is not configured.");
  }
}

export class BillingReconciliationService {
  constructor(
    private readonly db: Database,
    private readonly verifier: BillingWebhookVerifier
  ) {}

  async process(rawBody: Buffer, signature: string) {
    const event = await this.verifier.verify({ rawBody, signature });

    const payloadHash = createHash("sha256").update(rawBody).digest();

    const existing = await this.db.query(
      `SELECT payload_hash,processed
       FROM billing_webhook_events_v2
       WHERE id=$1`,
      [event.id]
    );

    if (existing.rowCount === 1) {
      const oldHash: Buffer = existing.rows[0].payload_hash;
      if (oldHash.length !== payloadHash.length || !timingSafeEqual(oldHash, payloadHash)) {
        throw new Error("billing webhook ID reused with different payload");
      }

      return {
        duplicate: true,
        processed: existing.rows[0].processed
      };
    }

    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO billing_webhook_events_v2(
           id,provider,event_type,payload_hash
         ) VALUES($1,'PRIMARY',$2,$3)`,
        [event.id, event.type, payloadHash]
      );

      // FIX (2026-08-07 apply pass): the pack upserted into a nonexistent
      // billing_entitlements_v2 table. The real entitlements table
      // (006_stages_21_30.sql) is `entitlements`
      // (user_id, entitlement_key, enabled, source, expires_at).
      if (event.userId && event.entitlementKey) {
        await client.query(
          `INSERT INTO entitlements(
             user_id,entitlement_key,enabled,source,expires_at
           ) VALUES($1,$2,$3,'WEBHOOK',$4)
           ON CONFLICT(user_id,entitlement_key)
           DO UPDATE SET
             enabled=EXCLUDED.enabled,
             source='WEBHOOK',
             expires_at=EXCLUDED.expires_at,
             updated_at=now()`,
          [event.userId, event.entitlementKey, event.active === true, event.expiresAt ?? null]
        );
      }

      await client.query(
        `UPDATE billing_webhook_events_v2
         SET processed=TRUE,processed_at=now()
         WHERE id=$1`,
        [event.id]
      );

      await client.query("COMMIT");

      return {
        duplicate: false,
        processed: true
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

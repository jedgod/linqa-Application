import type { Database } from "../db/pool.js";

export interface PushV2Provider {
  sendApns(input: { token: string; topic: string; payload: Record<string, unknown> }): Promise<{ messageId?: string }>;
  sendFcm(input: { token: string; payload: Record<string, unknown> }): Promise<{ messageId?: string }>;
}

/** No APNs/FCM credentials are configured in this environment (see APPLY_GUIDE.txt item 4). */
export class FailClosedPushV2Provider implements PushV2Provider {
  async sendApns(): Promise<never> {
    throw new Error("APNs provider is not configured.");
  }
  async sendFcm(): Promise<never> {
    throw new Error("FCM provider is not configured.");
  }
}

export class PushV2Service {
  constructor(
    private readonly db: Database,
    private readonly provider: PushV2Provider,
    private readonly decryptToken: (ciphertext: Buffer) => Promise<string>
  ) {}

  async sendWake(input: { userId: string; eventType: string; data?: Record<string, unknown> }) {
    const tokens = await this.db.query(
      `SELECT id,device_id,provider,token_ciphertext
       FROM push_device_tokens_v2
       WHERE user_id=$1 AND revoked_at IS NULL`,
      [input.userId]
    );

    for (const row of tokens.rows) {
      const token = await this.decryptToken(row.token_ciphertext);

      const payload = {
        type: input.eventType,
        // Never include plaintext message content.
        data: input.data ?? {}
      };

      try {
        const result =
          row.provider === "APNS"
            ? await this.provider.sendApns({ token, topic: process.env.APNS_BUNDLE_ID ?? "", payload })
            : await this.provider.sendFcm({ token, payload });

        await this.db.query(
          `INSERT INTO push_delivery_attempts_v2(
             user_id,device_id,provider,event_type,status,provider_message_id,attempt_count
           ) VALUES($1,$2,$3,$4,'SENT',$5,1)`,
          [input.userId, row.device_id, row.provider, input.eventType, result.messageId ?? null]
        );
      } catch (error) {
        await this.db.query(
          `INSERT INTO push_delivery_attempts_v2(
             user_id,device_id,provider,event_type,status,attempt_count,last_error
           ) VALUES($1,$2,$3,$4,'FAILED_RETRYABLE',1,$5)`,
          [input.userId, row.device_id, row.provider, input.eventType, error instanceof Error ? error.message : "unknown"]
        );
      }
    }
  }
}

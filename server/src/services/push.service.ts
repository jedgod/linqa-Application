import type { Database } from "../db/pool.js";
import { createHash } from "node:crypto";

export interface PushProvider {
  send(input: {
    token: string;
    title?: string;
    body?: string;
    data: Record<string, string>;
  }): Promise<{ providerMessageId?: string }>;
}

export interface TokenVault {
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

export class PushService {
  constructor(
    private readonly db: Database,
    private readonly vault: TokenVault,
    private readonly providers: Record<"APNS" | "FCM" | "WEB_PUSH", PushProvider>
  ) {}

  async register(input: {
    userId: string;
    deviceId: string;
    provider: "APNS" | "FCM" | "WEB_PUSH";
    token: string;
    appBundle: string;
    environment: "DEVELOPMENT" | "PRODUCTION";
  }) {
    if (input.token.length < 16) throw new Error("invalid push token");

    const fingerprint = createHash("sha256").update(input.token).digest();
    const ciphertext = await this.vault.encrypt(input.token);

    await this.db.query(
      `INSERT INTO push_endpoints (
         user_id, device_id, provider, token_ciphertext,
         token_fingerprint, app_bundle, environment, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE')
       ON CONFLICT (provider, token_fingerprint)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         device_id = EXCLUDED.device_id,
         token_ciphertext = EXCLUDED.token_ciphertext,
         app_bundle = EXCLUDED.app_bundle,
         environment = EXCLUDED.environment,
         status = 'ACTIVE',
         updated_at = now()`,
      [
        input.userId,
        input.deviceId,
        input.provider,
        ciphertext,
        fingerprint,
        input.appBundle,
        input.environment
      ]
    );
  }

  async notifyDevice(input: {
    deviceId: string;
    kind: "MESSAGE_AVAILABLE" | "INCOMING_CALL" | "SECURITY_ALERT";
    referenceId: string;
  }) {
    const endpoints = await this.db.query(
      `SELECT id, provider, token_ciphertext
       FROM push_endpoints
       WHERE device_id = $1 AND status = 'ACTIVE'`,
      [input.deviceId]
    );

    for (const endpoint of endpoints.rows) {
      try {
        const token = await this.vault.decrypt(endpoint.token_ciphertext);
        const provider = endpoint.provider as "APNS" | "FCM" | "WEB_PUSH";
        const result = await this.providers[provider].send({
          token,
          ...(input.kind === "INCOMING_CALL" ? { title: "Incoming Linqa call" } : {}),
          data: {
            kind: input.kind,
            referenceId: input.referenceId
          }
        });

        await this.db.query(
          `INSERT INTO push_delivery_events (
             endpoint_id, event_type, provider_message_id
           ) VALUES ($1,'SENT',$2)`,
          [endpoint.id, result.providerMessageId ?? null]
        );

        await this.db.query(
          `UPDATE push_endpoints
           SET last_success_at = now(), failure_count = 0
           WHERE id = $1`,
          [endpoint.id]
        );
      } catch (error) {
        await this.db.query(
          `UPDATE push_endpoints
           SET failure_count = failure_count + 1,
               last_failure_at = now(),
               status = CASE WHEN failure_count + 1 >= 5 THEN 'INVALID' ELSE status END
           WHERE id = $1`,
          [endpoint.id]
        );

        await this.db.query(
          `INSERT INTO push_delivery_events (
             endpoint_id, event_type, error_code
           ) VALUES ($1,'FAILED',$2)`,
          [endpoint.id, error instanceof Error ? error.message.slice(0, 100) : "unknown"]
        );
      }
    }
  }
}

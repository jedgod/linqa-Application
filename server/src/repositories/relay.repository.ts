import type { Database } from "../db/pool.js";

export interface StoreEnvelopeInput {
  senderDeviceId: string;
  recipientDeviceId: string;
  clientMessageId: string;
  ciphertext: Buffer;
  expiresAt: Date;
}

export class RelayRepository {
  constructor(private readonly db: Database) {}

  async store(input: StoreEnvelopeInput) {
    const result = await this.db.query(
      `INSERT INTO message_envelopes (
         sender_device_id,
         recipient_device_id,
         client_message_id,
         ciphertext,
         expires_at
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sender_device_id, client_message_id)
       DO UPDATE SET client_message_id = EXCLUDED.client_message_id
       RETURNING id, server_sequence, accepted_at,
                 (xmax = 0) AS inserted`,
      [
        input.senderDeviceId,
        input.recipientDeviceId,
        input.clientMessageId,
        input.ciphertext,
        input.expiresAt
      ]
    );
    return result.rows[0];
  }

  async lease(recipientDeviceId: string, limit: number, leaseSeconds: number) {
    const leaseOwner = crypto.randomUUID();
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `WITH candidates AS (
           SELECT id
           FROM message_envelopes
           WHERE recipient_device_id = $1
             AND acknowledged_at IS NULL
             AND expires_at > now()
             AND (lease_expires_at IS NULL OR lease_expires_at < now())
           ORDER BY server_sequence ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE message_envelopes m
         SET lease_owner = $3,
             lease_expires_at = now() + ($4 || ' seconds')::interval
         FROM candidates
         WHERE m.id = candidates.id
         RETURNING m.id, m.sender_device_id, m.client_message_id,
                   m.ciphertext, m.server_sequence, m.accepted_at, m.expires_at,
                   (SELECT signing_public_key FROM devices d WHERE d.id=m.sender_device_id)
                     AS sender_signing_public_key`,
        [recipientDeviceId, limit, leaseOwner, leaseSeconds]
      );

      await client.query("COMMIT");
      return { leaseOwner, envelopes: result.rows };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async acknowledge(
    recipientDeviceId: string,
    leaseOwner: string,
    envelopeIds: string[]
  ): Promise<number> {
    if (envelopeIds.length === 0) return 0;

    const result = await this.db.query(
      `UPDATE message_envelopes
       SET acknowledged_at = now(),
           lease_owner = NULL,
           lease_expires_at = NULL
       WHERE recipient_device_id = $1
         AND lease_owner = $2
         AND id = ANY($3::uuid[])
         AND acknowledged_at IS NULL`,
      [recipientDeviceId, leaseOwner, envelopeIds]
    );

    return result.rowCount ?? 0;
  }
}

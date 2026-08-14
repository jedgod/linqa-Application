import type { Database } from "../db/pool.js";
import { sha256 } from "../security/hash.js";

export class KeyTransparencyService {
  constructor(private readonly db: Database) {}

  async append(input: {
    userId: string;
    deviceId?: string;
    eventType:
      | "DEVICE_REGISTERED"
      | "DEVICE_REVOKED"
      | "KEY_PACKAGE_PUBLISHED"
      | "KEY_PACKAGE_REPLACED";
    objectHash: Buffer;
    payload: Record<string, unknown>;
  }) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`key-transparency:${input.userId}`]
      );

      const previous = await client.query(
        `SELECT event_hash
         FROM key_transparency_events
         WHERE user_id = $1
         ORDER BY sequence DESC
         LIMIT 1`,
        [input.userId]
      );

      const previousHash: Buffer | null = previous.rows[0]?.event_hash ?? null;
      const canonical = Buffer.from(
        JSON.stringify({
          userId: input.userId,
          deviceId: input.deviceId ?? null,
          eventType: input.eventType,
          objectHash: input.objectHash.toString("hex"),
          previousHash: previousHash?.toString("hex") ?? null,
          payload: input.payload
        }),
        "utf8"
      );
      const eventHash = sha256(canonical);

      const inserted = await client.query(
        `INSERT INTO key_transparency_events (
           user_id, device_id, event_type, object_hash,
           previous_event_hash, event_hash, event_payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING sequence, event_hash, created_at`,
        [
          input.userId,
          input.deviceId ?? null,
          input.eventType,
          input.objectHash,
          previousHash,
          eventHash,
          input.payload
        ]
      );

      await client.query("COMMIT");
      return inserted.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

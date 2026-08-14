import type { Database } from "../db/pool.js";
import { sha256 } from "../security/hash.js";

export interface PublishKeyPackageInput {
  userId: string;
  deviceId: string;
  packageVersion: number;
  packageBytes: Buffer;
  packageHash: Buffer;
  expiresAt: Date;
}

export class KeyPackageRepository {
  constructor(private readonly db: Database) {}

  async publish(input: PublishKeyPackageInput): Promise<{
    id: string;
    transparencySequence: string;
  }> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `key-transparency:${input.userId}`
      ]);

      const replaced = await client.query(
        `UPDATE key_packages
         SET replaced_at = now()
         WHERE device_id = $1 AND replaced_at IS NULL`,
        [input.deviceId]
      );

      const inserted = await client.query(
        `INSERT INTO key_packages (
           user_id, device_id, package_version, package_bytes, package_hash, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          input.userId,
          input.deviceId,
          input.packageVersion,
          input.packageBytes,
          input.packageHash,
          input.expiresAt
        ]
      );

      const events: Array<{
        eventType: "KEY_PACKAGE_PUBLISHED" | "KEY_PACKAGE_REPLACED";
        objectHash: Buffer;
        payload: Record<string, unknown>;
      }> = [];

      if ((replaced.rowCount ?? 0) > 0) {
        const previousPackage = await client.query(
          `SELECT id, package_hash
           FROM key_packages
           WHERE device_id = $1 AND replaced_at IS NOT NULL
           ORDER BY replaced_at DESC
           LIMIT 1`,
          [input.deviceId]
        );
        events.push({
          eventType: "KEY_PACKAGE_REPLACED",
          objectHash: previousPackage.rows[0].package_hash as Buffer,
          payload: { keyPackageId: previousPackage.rows[0].id }
        });
      }

      const keyPackageId = inserted.rows[0].id as string;
      events.push({
        eventType: "KEY_PACKAGE_PUBLISHED",
        objectHash: input.packageHash,
        payload: {
          keyPackageId,
          packageVersion: input.packageVersion,
          expiresAt: input.expiresAt.toISOString()
        }
      });

      let previousHash: Buffer | null = (
        await client.query(
          `SELECT event_hash
           FROM key_transparency_events
           WHERE user_id = $1
           ORDER BY sequence DESC
           LIMIT 1`,
          [input.userId]
        )
      ).rows[0]?.event_hash ?? null;
      let transparencySequence = "";

      for (const event of events) {
        const canonical = Buffer.from(
          JSON.stringify({
            userId: input.userId,
            deviceId: input.deviceId,
            eventType: event.eventType,
            objectHash: event.objectHash.toString("hex"),
            previousHash: previousHash?.toString("hex") ?? null,
            payload: event.payload
          }),
          "utf8"
        );
        const eventHash = sha256(canonical);
        const transparency = await client.query(
          `INSERT INTO key_transparency_events (
             user_id, device_id, event_type, object_hash,
             previous_event_hash, event_hash, event_payload
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING sequence`,
          [
            input.userId,
            input.deviceId,
            event.eventType,
            event.objectHash,
            previousHash,
            eventHash,
            event.payload
          ]
        );
        previousHash = eventHash;
        transparencySequence = String(transparency.rows[0].sequence);
      }

      await client.query("COMMIT");
      return { id: keyPackageId, transparencySequence };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findActiveForUser(userId: string) {
    const result = await this.db.query(
      `SELECT kp.id, kp.device_id, kp.package_version, kp.package_bytes,
              kp.package_hash, kp.expires_at, kp.created_at
       FROM key_packages kp
       JOIN devices d ON d.id = kp.device_id
       WHERE kp.user_id = $1
         AND kp.replaced_at IS NULL
         AND kp.expires_at > now()
         AND d.status = 'ACTIVE'
       ORDER BY kp.created_at DESC`,
      [userId]
    );
    return result.rows;
  }
}

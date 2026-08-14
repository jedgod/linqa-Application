import type { Database } from "../db/pool.js";

export class KeyPackageRepository {
  constructor(private readonly db: Database) {}

  async publish(input: {
    userId: string;
    deviceId: string;
    packageVersion: number;
    packageBytes: Buffer;
    packageHash: Buffer;
    expiresAt: Date;
  }) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE key_packages
         SET replaced_at = now()
         WHERE device_id = $1 AND replaced_at IS NULL`,
        [input.deviceId]
      );

      const result = await client.query(
        `INSERT INTO key_packages (
           user_id, device_id, package_version, package_bytes, package_hash, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, created_at`,
        [
          input.userId,
          input.deviceId,
          input.packageVersion,
          input.packageBytes,
          input.packageHash,
          input.expiresAt
        ]
      );

      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findForUser(userId: string) {
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

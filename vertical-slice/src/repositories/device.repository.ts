import type { Database } from "../db/pool.js";

export class DeviceRepository {
  constructor(private readonly db: Database) {}

  async findActive(deviceId: string, userId?: string) {
    const values: unknown[] = [deviceId];
    let userFilter = "";
    if (userId) {
      values.push(userId);
      userFilter = "AND user_id = $2";
    }

    const result = await this.db.query(
      `SELECT id, user_id, signing_public_key, encryption_public_key
       FROM devices
       WHERE id = $1 ${userFilter} AND status = 'ACTIVE'`,
      values
    );

    return result.rows[0] ?? null;
  }

  async touch(deviceId: string) {
    await this.db.query(
      `UPDATE devices SET last_seen_at = now() WHERE id = $1`,
      [deviceId]
    );
  }
}

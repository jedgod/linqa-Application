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
      `SELECT id, user_id, status, signing_public_key, encryption_public_key
       FROM devices
       WHERE id = $1 ${userFilter} AND status = 'ACTIVE'`,
      values
    );
    return result.rows[0] ?? null;
  }

  async revoke(deviceId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE devices
       SET status = 'REVOKED', revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND status <> 'REVOKED'`,
      [deviceId, userId]
    );
    return (result.rowCount ?? 0) === 1;
  }
}

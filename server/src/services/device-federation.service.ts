import type { Database } from "../db/pool.js";

export class DeviceFederationService {
  constructor(private readonly db: Database) {}

  async listTrusted(userId: string) {
    const result = await this.db.query(
      `SELECT d.id,d.device_name,d.platform,d.status,
              f.trust_state,f.device_generation,f.last_key_rotation_at
       FROM federated_user_devices f
       JOIN devices d ON d.id=f.device_id
       WHERE f.user_id=$1
       ORDER BY d.registered_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async approve(input: {
    userId: string;
    newDeviceId: string;
    approvingDeviceId: string;
    coreVerified: boolean;
  }) {
    if (!input.coreVerified) {
      throw new Error("device approval proof failed");
    }

    const trusted = await this.db.query(
      `SELECT 1
       FROM federated_user_devices
       WHERE user_id=$1
         AND device_id=$2
         AND trust_state='TRUSTED'`,
      [input.userId, input.approvingDeviceId]
    );

    if (trusted.rowCount !== 1) {
      throw new Error("approving device is not trusted");
    }

    await this.db.query(
      `INSERT INTO federated_user_devices(
         user_id,device_id,trust_state,approved_by_device_id
       ) VALUES($1,$2,'TRUSTED',$3)
       ON CONFLICT(user_id,device_id)
       DO UPDATE SET
         trust_state='TRUSTED',
         approved_by_device_id=EXCLUDED.approved_by_device_id`,
      [input.userId, input.newDeviceId, input.approvingDeviceId]
    );
  }

  async revoke(userId: string, deviceId: string) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE federated_user_devices
         SET trust_state='REVOKED'
         WHERE user_id=$1 AND device_id=$2`,
        [userId, deviceId]
      );

      await client.query(
        `UPDATE devices
         SET status='REVOKED'
         WHERE user_id=$1 AND id=$2`,
        [userId, deviceId]
      );

      await client.query(
        `UPDATE auth_sessions
         SET revoked_at=now()
         WHERE user_id=$1 AND device_id=$2 AND revoked_at IS NULL`,
        [userId, deviceId]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

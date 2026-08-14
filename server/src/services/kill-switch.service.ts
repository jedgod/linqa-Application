import type { Database } from "../db/pool.js";

export type KillSwitchKey =
  | "message_send_disabled"
  | "attachment_upload_disabled"
  | "new_device_enrollment_disabled"
  | "backup_restore_disabled";

export class KillSwitchService {
  constructor(private readonly db: Database) {}

  async assertEnabledOperation(key: KillSwitchKey): Promise<void> {
    const result = await this.db.query(
      `SELECT enabled, reason
       FROM operational_kill_switches
       WHERE key = $1`,
      [key]
    );
    const row = result.rows[0];

    if (!row) throw new Error(`kill switch configuration missing: ${key}`);
    if (row.enabled) {
      throw new Error(row.reason || `operation disabled: ${key}`);
    }
  }

  async set(input: {
    key: KillSwitchKey;
    enabled: boolean;
    reason: string;
    changedBy: string;
  }): Promise<void> {
    await this.db.query(
      `UPDATE operational_kill_switches
       SET enabled = $2,
           reason = $3,
           changed_by = $4,
           changed_at = now()
       WHERE key = $1`,
      [input.key, input.enabled, input.reason, input.changedBy]
    );
  }
}

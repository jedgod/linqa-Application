import type { Database } from "../db/pool.js";

export class SyncService {
  constructor(private readonly db: Database) {}

  async push(input: {
    userId: string;
    sourceDeviceId: string;
    records: Array<{
      clientRecordId: string;
      targetDeviceId?: string;
      recordType:
        | "MESSAGE"
        | "RECEIPT"
        | "CONTACT"
        | "SETTINGS"
        | "GROUP_STATE"
        | "TOMBSTONE"
        | "BACKUP_POINTER";
      ciphertext: Buffer;
      logicalClock: number;
      expiresAt?: Date;
    }>;
  }) {
    if (input.records.length === 0 || input.records.length > 500) {
      throw new Error("invalid sync batch size");
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      for (const record of input.records) {
        if (record.ciphertext.length < 16) {
          throw new Error("invalid encrypted sync record");
        }

        await client.query(
          `INSERT INTO sync_records (
             user_id,
             source_device_id,
             target_device_id,
             record_type,
             client_record_id,
             ciphertext,
             logical_clock,
             expires_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (source_device_id, client_record_id) DO NOTHING`,
          [
            input.userId,
            input.sourceDeviceId,
            record.targetDeviceId ?? null,
            record.recordType,
            record.clientRecordId,
            record.ciphertext,
            record.logicalClock,
            record.expiresAt ?? null
          ]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async pull(input: {
    userId: string;
    targetDeviceId: string;
    afterClock: number;
    limit: number;
  }) {
    const result = await this.db.query(
      `SELECT id, source_device_id, record_type, client_record_id,
              ciphertext, logical_clock, created_at
       FROM sync_records
       WHERE user_id = $1
         AND source_device_id <> $2
         AND (target_device_id IS NULL OR target_device_id = $2)
         AND logical_clock > $3
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY logical_clock ASC, created_at ASC
       LIMIT $4`,
      [input.userId, input.targetDeviceId, input.afterClock, input.limit]
    );

    return result.rows;
  }
}

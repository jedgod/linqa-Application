import type { Database } from "../db/pool.js";

const POLICY_SECONDS: Record<string, number | null> = {
  OFF: null,
  AFTER_30_SECONDS: 30,
  AFTER_5_MINUTES: 300,
  AFTER_1_HOUR: 3600,
  AFTER_1_DAY: 86400,
  AFTER_7_DAYS: 604800
};

export class DisappearingMessageService {
  constructor(private readonly db: Database) {}

  async computeExpiry(conversationId: string, readAt?: Date): Promise<Date | null> {
    const result = await this.db.query(
      `SELECT policy, delete_after_read
       FROM conversation_retention_policies
       WHERE conversation_id = $1`,
      [conversationId]
    );
    const row = result.rows[0];
    if (!row || row.policy === "OFF") return null;

    const seconds = POLICY_SECONDS[row.policy];
    if (!seconds) return null;

    const base = row.delete_after_read && readAt ? readAt.getTime() : Date.now();
    return new Date(base + seconds * 1000);
  }

  async recordReceipt(input: {
    messageId: string;
    deviceId: string;
    receiptType: "SCHEDULED" | "EXPIRED_LOCAL" | "DELETED_REMOTE" | "FAILED";
  }) {
    await this.db.query(
      `INSERT INTO message_expiry_receipts (
         message_id, device_id, receipt_type
       ) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [input.messageId, input.deviceId, input.receiptType]
    );
  }
}

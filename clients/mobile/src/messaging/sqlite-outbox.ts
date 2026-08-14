import * as SQLite from "expo-sqlite";
import type { MobileOutboxDb, MobileOutboxRow } from "./outbox";

/** Stores only Rust-core encrypted envelopes and partitions every operation by account. */
export class ExpoSqliteMobileOutboxDb implements MobileOutboxDb {
  private constructor(private readonly accountId: string, private readonly db: SQLite.SQLiteDatabase) {}

  static async open(accountId: string): Promise<ExpoSqliteMobileOutboxDb> {
    if (!accountId.trim()) throw new Error("OUTBOX_ACCOUNT_REQUIRED");
    const db = await SQLite.openDatabaseAsync("linqa-encrypted-outbox.db");
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS encrypted_mobile_outbox (
        message_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        recipient_device_id TEXT NOT NULL,
        encrypted_envelope_b64 TEXT NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS encrypted_mobile_outbox_due_idx
        ON encrypted_mobile_outbox(account_id, state, next_attempt_at);
    `);
    return new ExpoSqliteMobileOutboxDb(accountId, db);
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    let result: T;
    return this.db.withTransactionAsync(async () => { result = await fn(); }).then(() => result!);
  }

  async insert(row: MobileOutboxRow): Promise<void> {
    if (row.accountId !== this.accountId) throw new Error("OUTBOX_ACCOUNT_ISOLATION_VIOLATION");
    if (!row.encryptedEnvelopeB64) throw new Error("ENCRYPTED_ENVELOPE_REQUIRED");
    await this.db.runAsync(
      `INSERT INTO encrypted_mobile_outbox(
         message_id,account_id,conversation_id,recipient_device_id,
         encrypted_envelope_b64,state,attempts,next_attempt_at
       ) VALUES(?,?,?,?,?,?,?,?)`,
      row.messageId, row.accountId, row.conversationId, row.recipientDeviceId,
      row.encryptedEnvelopeB64, row.state, row.attempts, row.nextAttemptAt
    );
  }

  async due(limit: number): Promise<MobileOutboxRow[]> {
    const rows = await this.db.getAllAsync<any>(
      `SELECT * FROM encrypted_mobile_outbox
       WHERE account_id=? AND state IN ('CREATED','ENCRYPTED','QUEUED','SENDING','FAILED_RETRYABLE')
         AND next_attempt_at<=?
       ORDER BY next_attempt_at ASC LIMIT ?`,
      this.accountId, Date.now(), Math.max(1, Math.min(limit, 100))
    );
    return rows.map((row) => ({
      messageId: row.message_id, accountId: row.account_id,
      conversationId: row.conversation_id, recipientDeviceId: row.recipient_device_id,
      encryptedEnvelopeB64: row.encrypted_envelope_b64, state: row.state,
      attempts: row.attempts, nextAttemptAt: row.next_attempt_at
    }));
  }

  async update(messageId: string, patch: Partial<MobileOutboxRow>): Promise<void> {
    if (patch.accountId && patch.accountId !== this.accountId) throw new Error("OUTBOX_ACCOUNT_ISOLATION_VIOLATION");
    const allowed: Array<[keyof MobileOutboxRow, string]> = [
      ["state", "state"], ["attempts", "attempts"], ["nextAttemptAt", "next_attempt_at"],
      ["encryptedEnvelopeB64", "encrypted_envelope_b64"]
    ];
    const selected = allowed.filter(([key]) => patch[key] !== undefined);
    if (!selected.length) return;
    const result = await this.db.runAsync(
      `UPDATE encrypted_mobile_outbox SET ${selected.map(([, column]) => `${column}=?`).join(",")}
       WHERE message_id=? AND account_id=?`,
      ...selected.map(([key]) => patch[key] as string | number), messageId, this.accountId
    );
    if (result.changes !== 1) throw new Error("OUTBOX_MESSAGE_NOT_FOUND");
  }
}

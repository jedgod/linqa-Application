import * as SQLite from "expo-sqlite";
import type { MobileOutboxDb, MobileOutboxRow, MediaOutboxRow } from "./outbox";
import { getRandomBytes } from "expo-crypto";
import { loadOfflineMetadataKey } from "./offline-metadata-key";
import { OfflineMetadataCipher } from "./offline-metadata";
import { ProtectedMobileOutbox } from "./protected-outbox";

const toRow = (row: any): MobileOutboxRow => ({
  messageId: row.message_id, accountId: row.account_id,
  conversationId: row.conversation_id, recipientDeviceId: row.recipient_device_id,
  encryptedEnvelopeB64: row.encrypted_envelope_b64, state: row.state,
  attempts: row.attempts, nextAttemptAt: row.next_attempt_at,
  createdAt: row.created_at ?? row.next_attempt_at, errorCode: row.error_code ?? null
});

/** Stores only Rust-core encrypted envelopes and partitions every operation by account. */
export class ExpoSqliteMobileOutboxDb implements MobileOutboxDb {
  private constructor(private readonly accountId: string, private readonly db: SQLite.SQLiteDatabase) {}

  static async open(accountId: string): Promise<MobileOutboxDb> {
    if (!accountId.trim()) throw new Error("OUTBOX_ACCOUNT_REQUIRED");
    const cipher = new OfflineMetadataCipher(await loadOfflineMetadataKey(accountId), accountId, getRandomBytes);
    const db = await SQLite.openDatabaseAsync("linqa-encrypted-outbox.db");
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA secure_delete = ON;
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
      CREATE TABLE IF NOT EXISTS encrypted_media_uploads_v1 (
        message_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        envelope_b64 TEXT NOT NULL,
        ciphertext TEXT NOT NULL
      );
    `);
    // Older installs have the table without these two columns.
    const columns = (await db.getAllAsync<{ name: string }>("PRAGMA table_info(encrypted_mobile_outbox)")).map((c) => c.name);
    if (!columns.includes("created_at")) await db.execAsync("ALTER TABLE encrypted_mobile_outbox ADD COLUMN created_at INTEGER");
    if (!columns.includes("error_code")) await db.execAsync("ALTER TABLE encrypted_mobile_outbox ADD COLUMN error_code TEXT");
    const accountIndex = cipher.index("account", accountId);
    const protectedDb = new ProtectedMobileOutbox(new ExpoSqliteMobileOutboxDb(accountIndex, db), cipher, accountId);
    // Upgrade only this account. A transaction makes a crash retryable without dropping queued ciphertext.
    await db.withExclusiveTransactionAsync(async tx => {
      const messages = await tx.getAllAsync<any>("SELECT * FROM encrypted_mobile_outbox WHERE account_id=?", accountId);
      for (const record of messages) {
        const row = protectedDb.protectMessage(toRow(record));
        await tx.runAsync("UPDATE encrypted_mobile_outbox SET account_id=?,conversation_id=?,recipient_device_id=?,encrypted_envelope_b64=? WHERE message_id=? AND account_id=?",
          accountIndex, row.conversationId, row.recipientDeviceId, row.encryptedEnvelopeB64, row.messageId, accountId);
      }
      const media = await tx.getAllAsync<any>("SELECT * FROM encrypted_media_uploads_v1 WHERE account_id=?", accountId);
      for (const record of media) {
        const source: MediaOutboxRow = { messageId: record.message_id, conversationId: record.conversation_id, deviceId: record.device_id, mediaId: record.media_id, envelope: record.envelope_b64, ciphertext: record.ciphertext };
        const row = protectedDb.protectMedia(source, { messageId: source.messageId, accountId, conversationId: source.conversationId, recipientDeviceId: "*", encryptedEnvelopeB64: source.ciphertext, state: "QUEUED", attempts: 0, nextAttemptAt: Date.now() });
        await tx.runAsync("UPDATE encrypted_media_uploads_v1 SET account_id=?,conversation_id=?,device_id=?,media_id=?,envelope_b64=?,ciphertext=? WHERE message_id=? AND account_id=?",
          accountIndex, row.conversationId, row.deviceId, row.mediaId, row.envelope, row.ciphertext, row.messageId, accountId);
      }
    });
    return protectedDb;
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
         encrypted_envelope_b64,state,attempts,next_attempt_at,created_at
       ) VALUES(?,?,?,?,?,?,?,?,?)`,
      row.messageId, row.accountId, row.conversationId, row.recipientDeviceId,
      row.encryptedEnvelopeB64, row.state, row.attempts, row.nextAttemptAt, row.createdAt ?? Date.now()
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
    return rows.map(toRow);
  }

  async find(messageId: string): Promise<MobileOutboxRow | null> {
    const row = await this.db.getFirstAsync<any>(
      "SELECT * FROM encrypted_mobile_outbox WHERE message_id=? AND account_id=?", messageId, this.accountId
    );
    return row ? toRow(row) : null;
  }

  async pending(limit: number): Promise<MobileOutboxRow[]> {
    const rows = await this.db.getAllAsync<any>(
      `SELECT * FROM encrypted_mobile_outbox
       WHERE account_id=? AND state IN ('CREATED','ENCRYPTED','QUEUED','SENDING','FAILED_RETRYABLE')
       ORDER BY next_attempt_at ASC LIMIT ?`,
      this.accountId, Math.max(1, Math.min(limit, 100))
    );
    return rows.map(toRow);
  }

  async remove(messageId: string): Promise<void> {
    await this.db.runAsync("DELETE FROM encrypted_media_uploads_v1 WHERE message_id=? AND account_id=?", messageId, this.accountId);
    await this.db.runAsync("DELETE FROM encrypted_mobile_outbox WHERE message_id=? AND account_id=?", messageId, this.accountId);
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
  async markPermanent(conversationId: string, messageId: string, errorCode: string): Promise<void> {
    // Only a row this account still holds unresolved can be refused; an already-refused row is left as it is.
    const result = await this.db.runAsync(
      `UPDATE encrypted_mobile_outbox SET state='FAILED_PERMANENT', error_code=?
       WHERE message_id=? AND account_id=? AND conversation_id=? AND state IN ('CREATED','ENCRYPTED','QUEUED','SENDING','FAILED_RETRYABLE')`,
      errorCode, messageId, this.accountId, conversationId
    );
    if (result.changes === 1) return;
    const row = await this.find(messageId);
    if (!row || row.conversationId !== conversationId || row.state !== "FAILED_PERMANENT") throw new Error("OUTBOX_MESSAGE_NOT_FOUND");
  }

  async listPermanent(conversationId: string) {
    const rows = await this.db.getAllAsync<any>(
      `SELECT message_id, conversation_id, created_at, next_attempt_at, error_code FROM encrypted_mobile_outbox
       WHERE account_id=? AND conversation_id=? AND state='FAILED_PERMANENT' ORDER BY created_at ASC, message_id ASC`,
      this.accountId, conversationId
    );
    return rows.map((r) => ({ messageId: r.message_id as string, conversationId: r.conversation_id as string, createdAt: (r.created_at ?? r.next_attempt_at) as number, errorCode: (r.error_code ?? "RELAY_REJECTED") as string }));
  }

  async deletePermanent(conversationId: string, messageId: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM encrypted_media_uploads_v1 WHERE message_id=? AND account_id=?
      AND EXISTS(SELECT 1 FROM encrypted_mobile_outbox o WHERE o.message_id=? AND o.account_id=? AND o.conversation_id=? AND o.state='FAILED_PERMANENT')`,
      messageId, this.accountId, messageId, this.accountId, conversationId);
    await this.db.runAsync(
      "DELETE FROM encrypted_mobile_outbox WHERE message_id=? AND account_id=? AND conversation_id=? AND state='FAILED_PERMANENT'",
      messageId, this.accountId, conversationId
    );
  }

  async findMedia(messageId: string): Promise<MediaOutboxRow | null> {
    const row = await this.db.getFirstAsync<any>("SELECT * FROM encrypted_media_uploads_v1 WHERE message_id=? AND account_id=?", messageId, this.accountId);
    return row ? { messageId: row.message_id, conversationId: row.conversation_id, deviceId: row.device_id, mediaId: row.media_id, envelope: row.envelope_b64, ciphertext: row.ciphertext } : null;
  }

  async putMedia(row: MediaOutboxRow): Promise<void> {
    if (!row.deviceId || !row.envelope || !row.ciphertext) throw new Error("SEALED_MEDIA_REQUIRED");
    await this.db.withExclusiveTransactionAsync(async tx => {
      const existing = await tx.getFirstAsync<any>("SELECT * FROM encrypted_media_uploads_v1 WHERE message_id=?", row.messageId);
      if (existing) {
        if (existing.account_id !== this.accountId || existing.device_id !== row.deviceId || existing.conversation_id !== row.conversationId || existing.media_id !== row.mediaId || existing.envelope_b64 !== row.envelope || existing.ciphertext !== row.ciphertext) throw new Error("MEDIA_ID_REUSE");
        return;
      }
      const usage = await tx.getFirstAsync<{ bytes: number }>("SELECT COALESCE(sum(length(envelope_b64)),0) AS bytes FROM encrypted_media_uploads_v1 WHERE account_id=?", this.accountId);
      if ((usage?.bytes ?? 0) + row.envelope.length > 180_000_000) throw new Error("MEDIA_QUEUE_FULL");
      await tx.runAsync("INSERT INTO encrypted_media_uploads_v1 VALUES(?,?,?,?,?,?,?)", row.messageId, this.accountId, row.conversationId, row.deviceId, row.mediaId, row.envelope, row.ciphertext);
      await tx.runAsync(`INSERT INTO encrypted_mobile_outbox(message_id,account_id,conversation_id,recipient_device_id,encrypted_envelope_b64,state,attempts,next_attempt_at,created_at)
        VALUES(?,?,?,?,?,'QUEUED',0,?,?)`, row.messageId, this.accountId, row.conversationId, "*", row.ciphertext, Date.now(), Date.now());
    });
  }
}

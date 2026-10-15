import type { MediaOutboxRow, MobileOutboxDb, MobileOutboxRow } from "./outbox";
import { OfflineMetadataCipher } from "./offline-metadata";

/** Only keyed indexes and scheduling fields reach SQLite; full logical rows are locally authenticated ciphertext. */
export class ProtectedMobileOutbox implements MobileOutboxDb {
  constructor(private readonly raw: MobileOutboxDb, private readonly cipher: OfflineMetadataCipher, private readonly accountId: string) {}

  protectMessage(row: MobileOutboxRow): MobileOutboxRow {
    if (row.accountId !== this.accountId) throw new Error("OUTBOX_ACCOUNT_ISOLATION_VIOLATION");
    return { ...row, accountId: this.cipher.index("account", this.accountId), conversationId: this.cipher.index("conversation", row.conversationId),
      recipientDeviceId: this.cipher.index("device", row.recipientDeviceId), encryptedEnvelopeB64: this.cipher.seal(row, "message", row.messageId) };
  }
  private openMessage(row: MobileOutboxRow): MobileOutboxRow {
    const opened = this.cipher.open<MobileOutboxRow>(row.encryptedEnvelopeB64, "message", row.messageId);
    if (opened.accountId !== this.accountId || opened.messageId !== row.messageId || this.cipher.index("conversation", opened.conversationId) !== row.conversationId) throw new Error("OUTBOX_ACCOUNT_ISOLATION_VIOLATION");
    // Scheduling/status is mutable independently from the sealed message, and remains visible locally.
    return { ...opened, state: row.state, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt, errorCode: row.errorCode };
  }
  protectMedia(row: MediaOutboxRow, message: MobileOutboxRow): MediaOutboxRow {
    return { messageId: row.messageId, conversationId: this.cipher.index("conversation", row.conversationId), deviceId: this.cipher.index("device", row.deviceId),
      mediaId: this.cipher.index("media", row.mediaId), envelope: this.cipher.seal(row, "media", row.messageId), ciphertext: this.protectMessage(message).encryptedEnvelopeB64 };
  }
  transaction<T>(fn: () => Promise<T>): Promise<T> { return this.raw.transaction(fn); }
  async insert(row: MobileOutboxRow): Promise<void> {
    if (!row.encryptedEnvelopeB64) throw new Error("ENCRYPTED_ENVELOPE_REQUIRED");
    await this.raw.insert(this.protectMessage(row));
  }
  async find(id: string) { const row = await this.raw.find(id); return row ? this.openMessage(row) : null; }
  async due(limit: number) { return (await this.raw.due(limit)).map(row => this.openMessage(row)); }
  async pending(limit: number) { return (await this.raw.pending(limit)).map(row => this.openMessage(row)); }
  remove(id: string) { return this.raw.remove(id); }
  async update(id: string, patch: Partial<MobileOutboxRow>) {
    if (patch.accountId !== undefined && patch.accountId !== this.accountId) throw new Error("OUTBOX_ACCOUNT_ISOLATION_VIOLATION");
    const current = await this.find(id);
    if (!current) throw new Error("OUTBOX_MESSAGE_NOT_FOUND");
    // The raw adapter intentionally supports only these mutable properties.
    const selected: Partial<MobileOutboxRow> = {};
    if (patch.state !== undefined) selected.state = patch.state;
    if (patch.attempts !== undefined) selected.attempts = patch.attempts;
    if (patch.nextAttemptAt !== undefined) selected.nextAttemptAt = patch.nextAttemptAt;
    if (patch.encryptedEnvelopeB64 !== undefined) {
      if (!patch.encryptedEnvelopeB64) throw new Error("ENCRYPTED_ENVELOPE_REQUIRED");
      selected.encryptedEnvelopeB64 = this.protectMessage({ ...current, encryptedEnvelopeB64: patch.encryptedEnvelopeB64 }).encryptedEnvelopeB64;
    }
    await this.raw.update(id, selected);
  }
  markPermanent(conversationId: string, id: string, code: string) { return this.raw.markPermanent(this.cipher.index("conversation", conversationId), id, code); }
  async listPermanent(conversationId: string) { return (await this.raw.listPermanent(this.cipher.index("conversation", conversationId))).map(row => ({ ...row, conversationId })); }
  deletePermanent(conversationId: string, id: string) { return this.raw.deletePermanent(this.cipher.index("conversation", conversationId), id); }
  async findMedia(id: string): Promise<MediaOutboxRow | null> {
    const row = await this.raw.findMedia?.(id);
    if (!row) return null;
    const opened = this.cipher.open<MediaOutboxRow>(row.envelope, "media", id);
    if (opened.messageId !== id || this.cipher.index("conversation", opened.conversationId) !== row.conversationId) throw new Error("OUTBOX_ACCOUNT_ISOLATION_VIOLATION");
    return opened;
  }
  async putMedia(row: MediaOutboxRow) {
    const existing = await this.findMedia(row.messageId);
    if (existing) {
      if (existing.deviceId !== row.deviceId || existing.mediaId !== row.mediaId || existing.conversationId !== row.conversationId || existing.envelope !== row.envelope || existing.ciphertext !== row.ciphertext) throw new Error("MEDIA_ID_REUSE");
      return;
    }
    if (!row.deviceId || !row.envelope || !row.ciphertext || !this.raw.putMedia) throw new Error("SEALED_MEDIA_REQUIRED");
    const now = Date.now();
    const message: MobileOutboxRow = { messageId: row.messageId, accountId: this.accountId, conversationId: row.conversationId, recipientDeviceId: "*", encryptedEnvelopeB64: row.ciphertext, state: "QUEUED", attempts: 0, nextAttemptAt: now, createdAt: now };
    try { await this.raw.putMedia(this.protectMedia(row, message)); }
    catch (error) {
      // A concurrent identical retry used different GCM nonces; compare logical content after the transaction.
      const retry = await this.findMedia(row.messageId);
      if (!retry || retry.deviceId !== row.deviceId || retry.mediaId !== row.mediaId || retry.conversationId !== row.conversationId || retry.envelope !== row.envelope || retry.ciphertext !== row.ciphertext) throw error;
    }
  }
}

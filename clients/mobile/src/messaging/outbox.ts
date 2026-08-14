export type OutboxState = "CREATED" | "ENCRYPTED" | "QUEUED" | "SENDING" | "ACCEPTED_BY_RELAY" | "DELIVERED" | "FAILED_RETRYABLE" | "FAILED_PERMANENT";

export interface MobileOutboxRow {
  messageId: string;
  accountId: string;
  conversationId: string;
  recipientDeviceId: string;
  encryptedEnvelopeB64: string;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: number;
}

export interface MobileOutboxDb {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  insert(row: MobileOutboxRow): Promise<void>;
  due(limit: number): Promise<MobileOutboxRow[]>;
  update(messageId: string, patch: Partial<MobileOutboxRow>): Promise<void>;
}

export class OutboxWorker {
  constructor(private db: MobileOutboxDb, private send: (envelopeB64: string) => Promise<void>) {}
  async flush(limit = 50): Promise<void> {
    for (const row of await this.db.due(limit)) {
      try {
        await this.db.update(row.messageId, { state: "SENDING" });
        await this.send(row.encryptedEnvelopeB64);
        await this.db.update(row.messageId, { state: "ACCEPTED_BY_RELAY" });
      } catch {
        const attempts = row.attempts + 1;
        const backoff = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
        await this.db.update(row.messageId, { state: "FAILED_RETRYABLE", attempts, nextAttemptAt: Date.now() + backoff });
      }
    }
  }
}


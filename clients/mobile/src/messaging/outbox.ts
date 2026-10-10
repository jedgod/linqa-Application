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
  /** When the row was first queued; unlike nextAttemptAt it never moves on a retry. */
  createdAt?: number;
  /** Set with FAILED_PERMANENT: the relay's reason code. No ciphertext or text. */
  errorCode?: string | null;
}

export type MediaOutboxRow = { messageId: string; conversationId: string; deviceId: string; mediaId: string; envelope: string; ciphertext: string };
export interface MobileOutboxDb {
  putMedia?(row: MediaOutboxRow): Promise<void>;
  findMedia?(messageId: string): Promise<MediaOutboxRow | null>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  insert(row: MobileOutboxRow): Promise<void>;
  due(limit: number): Promise<MobileOutboxRow[]>;
  find(messageId: string): Promise<MobileOutboxRow | null>;
  /** Every row still waiting to be accepted by the relay, regardless of backoff. */
  pending(limit: number): Promise<MobileOutboxRow[]>;
  remove(messageId: string): Promise<void>;
  update(messageId: string, patch: Partial<MobileOutboxRow>): Promise<void>;
  /** Idempotent: an already FAILED_PERMANENT row stays so. Never touches an accepted/missing row's bytes. */
  markPermanent(conversationId: string, messageId: string, errorCode: string): Promise<void>;
  listPermanent(conversationId: string): Promise<Array<{ messageId: string; conversationId: string; createdAt: number; errorCode: string }>>;
  /** Deletes only a FAILED_PERMANENT row; anything else (or nothing) is a no-op. */
  deletePermanent(conversationId: string, messageId: string): Promise<void>;
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


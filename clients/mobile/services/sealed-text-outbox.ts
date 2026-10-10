import type { MobileOutboxDb, MediaOutboxRow } from "../src/messaging/outbox";
import { createRejectedOutbox, type RejectedOutbox, type RejectedOutboxPersistence } from "./rejected-outbox";

/**
 * The sealed (already encrypted) text messages this phone has not yet seen the relay accept. Keeping the exact bytes means a
 * retry after a dropped connection or an app restart sends the same ciphertext under the same message id: nothing is sealed
 * twice, and the server's de-duplication on the message id sees one message. Plain text never reaches this store.
 */
export interface SealedTextOutbox {
  media?: { put(row: MediaOutboxRow): Promise<void>; find(messageId: string): Promise<MediaOutboxRow | null> };
  find(messageId: string): Promise<string | null>;
  put(messageId: string, conversationId: string, ciphertext: string): Promise<void>;
  remove(messageId: string): Promise<void>;
  pending(limit?: number): Promise<Array<{ messageId: string; conversationId: string; ciphertext: string }>>;
  /** Messages the relay refused for good: kept (sealed, unreadable) so they can be shown and discarded, never dropped silently. */
  failures: RejectedOutbox;
}

/** One bundle already covers every device of every member, so rows are not split per recipient device. */
const ALL_DEVICES = "*";

export function sealedTextOutbox(db: MobileOutboxDb, accountId: string): SealedTextOutbox {
  const persistence: RejectedOutboxPersistence = {
    markPermanent: (scope, messageId, code) => db.markPermanent(scope.conversationId, messageId, code),
    async listPermanent(scope) {
      return (await db.listPermanent(scope.conversationId)).map((r) => ({ accountId, conversationId: r.conversationId, messageId: r.messageId, createdAt: new Date(r.createdAt).toISOString(), errorCode: r.errorCode }));
    },
    deletePermanent: (scope, messageId) => db.deletePermanent(scope.conversationId, messageId)
  };
  const failures = createRejectedOutbox(persistence, accountId);
  return {
    ...(db.putMedia && db.findMedia ? { media: { put: (row: MediaOutboxRow) => db.putMedia!(row), find: (id: string) => db.findMedia!(id) } } : {}),
    failures,
    async find(messageId) { return (await db.find(messageId))?.encryptedEnvelopeB64 ?? null; },
    async put(messageId, conversationId, ciphertext) {
      await db.insert({ messageId, accountId, conversationId, recipientDeviceId: ALL_DEVICES, encryptedEnvelopeB64: ciphertext, state: "QUEUED", attempts: 0, nextAttemptAt: Date.now() });
    },
    remove: (messageId) => db.remove(messageId),
    async pending(limit = 50) {
      return (await db.pending(limit)).map((r) => ({ messageId: r.messageId, conversationId: r.conversationId, ciphertext: r.encryptedEnvelopeB64 }));
    }
  };
}

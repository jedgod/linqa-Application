import { WebCryptoKeyProvider } from "../security/WebCryptoKeyProvider";
import type { EncryptedLocalStore, LocalMessage } from "./EncryptedLocalStore";

const DB_PREFIX = "linqa-messages";
const STORE = "messages";
const STATE_INDEX = "by_state";
const WRAPPING_KEY_PREFIX = "message-local-store";

// States OutboxWorker should retry: queued for the first attempt, or a
// previous attempt failed in a retryable way.
const PENDING_STATES = ["QUEUED", "UPLOADING", "FAILED_RETRYABLE"];

interface StoredRecord {
  id: string;
  conversationId: string;
  direction: "INCOMING" | "OUTGOING";
  sealedCiphertext: Uint8Array;
  state: string;
  createdAt: string;
  updatedAt: string;
  recipientDeviceId?: string;
  expiresAt?: string;
}

function context(record: { id: string; conversationId: string }): Uint8Array {
  return new TextEncoder().encode(`linqa:local-message:${record.conversationId}:${record.id}`);
}

/**
 * Real IndexedDB-backed EncryptedLocalStore. Message ciphertext (already
 * E2E-encrypted by linqa-core) is additionally wrapped at rest with a local
 * AES-GCM key via WebCryptoKeyProvider, so a raw dump of this database does
 * not equal the on-wire ciphertext bytes.
 */
export class EncryptedIndexedDbStore implements EncryptedLocalStore {
  private readonly dbName: string;
  private readonly wrappingKeyAlias: string;

  constructor(
    accountId: string,
    private readonly keys: WebCryptoKeyProvider = new WebCryptoKeyProvider()
  ) {
    if (!accountId.trim()) throw new Error("accountId is required for encrypted local storage");
    this.dbName = `${DB_PREFIX}:${accountId}`;
    this.wrappingKeyAlias = `${WRAPPING_KEY_PREFIX}:${accountId}`;
  }

  async putMessage(message: LocalMessage): Promise<void> {
    await this.keys.createWrappingKey(this.wrappingKeyAlias);
    const sealedCiphertext = await this.keys.wrapKey({
      alias: this.wrappingKeyAlias,
      rawKey: message.ciphertext,
      context: context(message)
    });

    const record: StoredRecord = {
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction,
      sealedCiphertext,
      state: message.state,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      recipientDeviceId: message.recipientDeviceId,
      expiresAt: message.expiresAt
    };

    const db = await openDb(this.dbName);
    try {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(record);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  async updateMessageState(messageId: string, state: string): Promise<void> {
    const db = await openDb(this.dbName);
    try {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const existing = await requestDone<StoredRecord | undefined>(store.get(messageId));
      if (!existing) throw new Error("local message not found");

      store.put({ ...existing, state, updatedAt: new Date().toISOString() });
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  async listPendingOutbox(limit: number): Promise<LocalMessage[]> {
    const db = await openDb(this.dbName);
    let records: StoredRecord[];
    try {
      const transaction = db.transaction(STORE, "readonly");
      const index = transaction.objectStore(STORE).index(STATE_INDEX);
      const batches = await Promise.all(
        PENDING_STATES.map((state) =>
          requestDone<StoredRecord[]>(index.getAll(IDBKeyRange.only(state)))
        )
      );
      await transactionDone(transaction);
      records = batches
        .flat()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit);
    } finally {
      db.close();
    }

    const messages: LocalMessage[] = [];
    for (const record of records) {
      const ciphertext = await this.keys.unwrapKey({
        alias: this.wrappingKeyAlias,
        wrappedKey: record.sealedCiphertext,
        context: context(record)
      });
      messages.push({
        id: record.id,
        conversationId: record.conversationId,
        direction: record.direction,
        ciphertext,
        state: record.state,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        recipientDeviceId: record.recipientDeviceId,
        expiresAt: record.expiresAt
      });
    }
    return messages;
  }

  async getMessage(messageId: string): Promise<LocalMessage | null> {
    const db = await openDb(this.dbName);
    let record: StoredRecord | undefined;
    try {
      const transaction = db.transaction(STORE, "readonly");
      record = await requestDone<StoredRecord | undefined>(transaction.objectStore(STORE).get(messageId));
      await transactionDone(transaction);
    } finally {
      db.close();
    }
    if (!record) return null;
    const ciphertext = await this.keys.unwrapKey({
      alias: this.wrappingKeyAlias,
      wrappedKey: record.sealedCiphertext,
      context: context(record)
    });
    return { ...record, ciphertext };
  }
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        const store = request.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(STATE_INDEX, "state", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
  });
}

export function createDefaultEncryptedLocalStore(accountId: string): EncryptedLocalStore {
  return new EncryptedIndexedDbStore(accountId);
}

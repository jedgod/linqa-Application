import { WebCryptoKeyProvider } from "../security/WebCryptoKeyProvider";

/**
 * Older messages that a phone sent to this computer. They are kept in this browser only, sealed with a key that lives in the browser's
 * key store and cannot be exported, one record per conversation. Signing out deletes the records and the key.
 */
const DB_NAME = "linqa-web-history";
const STORE = "conversations";
const KEY_ALIAS = "linqa-web-history-key";
const CONTEXT = new TextEncoder().encode("linqa:web-history:v1");

export interface HistoryEntry { id: string; senderUserId: string; at: string; text: string }
type Records = Record<string, HistoryEntry>;

const keys = new WebCryptoKeyProvider();
let keyReady: Promise<void> | null = null;
const ensureKey = () => (keyReady ??= keys.createWrappingKey(KEY_ALIAS).then(() => undefined).catch((e) => { keyReady = null; throw e; }));

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("HISTORY_STORE_UNAVAILABLE"));
  });
}
function run<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? new Error("HISTORY_STORE_FAILED"));
    tx.onabort = () => reject(tx.error ?? new Error("HISTORY_STORE_FAILED"));
  });
}

async function readRecords(db: IDBDatabase, conversationId: string): Promise<Records> {
  const sealed = await run<Uint8Array | undefined>(db, "readonly", (s) => s.get(conversationId));
  if (!sealed) return {};
  try {
    const plain = await keys.unwrapKey({ alias: KEY_ALIAS, wrappedKey: sealed, context: CONTEXT });
    return JSON.parse(new TextDecoder().decode(plain)) as Records;
  } catch { return {}; }
}

export class HistoryStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly cache = new Map<string, Records>();
  private readonly listeners = new Set<() => void>();

  private db() { return (this.dbPromise ??= open()); }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** Every saved message of a conversation, oldest first. Empty when nothing was saved or the browser cannot store it. */
  async messages(conversationId: string): Promise<HistoryEntry[]> {
    try {
      let records = this.cache.get(conversationId);
      if (!records) { records = await readRecords(await this.db(), conversationId); this.cache.set(conversationId, records); }
      return Object.values(records).sort((a, b) => a.at.localeCompare(b.at));
    } catch { return []; }
  }

  /** Adds messages (ones already saved are kept as they are). Returns how many were new. */
  async add(conversationId: string, entries: HistoryEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    await ensureKey();
    const db = await this.db();
    const records = { ...(await readRecords(db, conversationId)) };
    let added = 0;
    for (const entry of entries) if (!records[entry.id]) { records[entry.id] = entry; added += 1; }
    if (added === 0) return 0;
    const sealed = await keys.wrapKey({ alias: KEY_ALIAS, rawKey: new TextEncoder().encode(JSON.stringify(records)), context: CONTEXT });
    await run(db, "readwrite", (s) => s.put(sealed, conversationId));
    this.cache.set(conversationId, records);
    this.listeners.forEach((l) => l());
    return added;
  }

  /** Drops what the phone sent for one conversation (after the person clears or deletes that chat). */
  async forget(conversationId: string): Promise<void> {
    this.cache.delete(conversationId);
    try { await run(await this.db(), "readwrite", (s) => s.delete(conversationId)); } catch { /* nothing stored */ }
    this.listeners.forEach((l) => l());
  }

  async clear(): Promise<void> {
    this.cache.clear();
    try { (await this.db()).close(); } catch { /* not open */ }
    this.dbPromise = null;
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    try { await keys.deleteKey(KEY_ALIAS); } catch { /* nothing to delete */ }
    keyReady = null;
  }
}

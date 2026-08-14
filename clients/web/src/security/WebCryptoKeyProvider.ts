const DB_NAME = "linqa-key-custody";
const STORE = "keys";

export class WebCryptoKeyProvider {
  async createWrappingKey(alias: string): Promise<void> {
    if (await this.getKey(alias)) return;
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await this.putKey(alias, key);
  }

  async wrapKey(input: { alias: string; rawKey: Uint8Array; context: Uint8Array }) {
    const key = await this.requireKey(input.alias);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const context = Uint8Array.from(input.context);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: context },
      key,
      Uint8Array.from(input.rawKey),
    );
    const output = new Uint8Array(12 + ciphertext.byteLength);
    output.set(nonce);
    output.set(new Uint8Array(ciphertext), 12);
    return output;
  }

  async unwrapKey(input: { alias: string; wrappedKey: Uint8Array; context: Uint8Array }) {
    if (input.wrappedKey.length < 29) throw new Error("invalid wrapped key");
    const context = Uint8Array.from(input.context);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: input.wrappedKey.slice(0, 12),
        additionalData: context,
      },
      await this.requireKey(input.alias),
      input.wrappedKey.slice(12),
    );
    return new Uint8Array(plaintext);
  }

  async deleteKey(alias: string) {
    const db = await openDb();
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(alias);
    await transactionDone(transaction);
    db.close();
  }

  async supportsHardwareBackedKeys() { return false; }

  private async requireKey(alias: string) {
    const key = await this.getKey(alias);
    if (!key) throw new Error("wrapping key not found");
    return key;
  }

  private async getKey(alias: string): Promise<CryptoKey | null> {
    const db = await openDb();
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(alias);
    const value = await requestDone<{ alias: string; key: CryptoKey } | undefined>(request);
    await transactionDone(transaction);
    db.close();
    return value?.key ?? null;
  }

  private async putKey(alias: string, key: CryptoKey) {
    const db = await openDb();
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({ alias, key });
    await transactionDone(transaction);
    db.close();
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "alias" });
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
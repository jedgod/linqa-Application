import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export interface SecureNamespaceAdapter {
  protectionLevel?(): Promise<"OS_PROTECTED" | null>;
  put(namespace: string, key: string, value: string): Promise<void>;
  get(namespace: string, key: string): Promise<string | null>;
  remove(namespace: string, key: string): Promise<void>;
  destroyNamespace(namespace: string): Promise<void>;
}

/**
 * Real per-account secure storage backed by expo-secure-store (Keychain on
 * iOS, Keystore-backed EncryptedSharedPreferences on Android) — not part of
 * the source pack, which left SecureNamespaceAdapter as an interface with
 * no implementation. expo-secure-store has no native "list/delete by
 * prefix" API, so each namespace maintains a small JSON index of its own
 * keys (itself stored in SecureStore) to make destroyNamespace() real
 * rather than a no-op.
 */
function storageKey(namespace: string, key: string): string {
  return `${namespace.replace(/[^A-Za-z0-9._-]/g, "_")}__${key}`;
}

function indexKey(namespace: string): string {
  return storageKey(namespace, "__index__");
}

export class SecureStoreNamespaceAdapter implements SecureNamespaceAdapter {
  async protectionLevel(): Promise<"OS_PROTECTED" | null> {
    return await SecureStore.isAvailableAsync() ? "OS_PROTECTED" : null;
  }
  private async readIndex(namespace: string): Promise<string[]> {
    const raw = await SecureStore.getItemAsync(indexKey(namespace));
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  private async writeIndex(namespace: string, keys: string[]): Promise<void> {
    await SecureStore.setItemAsync(indexKey(namespace), JSON.stringify(keys));
  }

  async put(namespace: string, key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(storageKey(namespace, key), value);
    const index = await this.readIndex(namespace);
    if (!index.includes(key)) {
      await this.writeIndex(namespace, [...index, key]);
    }
  }

  async get(namespace: string, key: string): Promise<string | null> {
    return SecureStore.getItemAsync(storageKey(namespace, key));
  }

  async remove(namespace: string, key: string): Promise<void> {
    await SecureStore.deleteItemAsync(storageKey(namespace, key));
    const index = await this.readIndex(namespace);
    await this.writeIndex(
      namespace,
      index.filter((k) => k !== key)
    );
  }

  async destroyNamespace(namespace: string): Promise<void> {
    const index = await this.readIndex(namespace);
    for (const key of index) {
      await SecureStore.deleteItemAsync(storageKey(namespace, key));
    }
    await SecureStore.deleteItemAsync(indexKey(namespace));
  }
}

/**
 * 2026-08-07: expo-secure-store's web implementation in this SDK doesn't
 * implement getItemAsync at all (confirmed by reproducing the crash this
 * fix addresses — it throws "getValueWithKeyAsync is not a function").
 * Web falls back to localStorage instead, matching the same trust tier the
 * web *client* (clients/web) already uses for its own session token
 * (sessionStorage) — not Keychain/Keystore-grade, but a real, working
 * implementation rather than a silent no-op or a crash.
 */
export class LocalStorageNamespaceAdapter implements SecureNamespaceAdapter {
  private readIndex(namespace: string): string[] {
    const raw = window.localStorage.getItem(indexKey(namespace));
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  private writeIndex(namespace: string, keys: string[]): void {
    window.localStorage.setItem(indexKey(namespace), JSON.stringify(keys));
  }

  async put(namespace: string, key: string, value: string): Promise<void> {
    window.localStorage.setItem(storageKey(namespace, key), value);
    const index = this.readIndex(namespace);
    if (!index.includes(key)) this.writeIndex(namespace, [...index, key]);
  }

  async get(namespace: string, key: string): Promise<string | null> {
    return window.localStorage.getItem(storageKey(namespace, key));
  }

  async remove(namespace: string, key: string): Promise<void> {
    window.localStorage.removeItem(storageKey(namespace, key));
    this.writeIndex(
      namespace,
      this.readIndex(namespace).filter((k) => k !== key)
    );
  }

  async destroyNamespace(namespace: string): Promise<void> {
    for (const key of this.readIndex(namespace)) {
      window.localStorage.removeItem(storageKey(namespace, key));
    }
    window.localStorage.removeItem(indexKey(namespace));
  }
}

function defaultAdapter(): SecureNamespaceAdapter {
  return Platform.OS === "web" ? new LocalStorageNamespaceAdapter() : new SecureStoreNamespaceAdapter();
}

export class AccountSecureStorage {
  constructor(private readonly adapter: SecureNamespaceAdapter = defaultAdapter()) {}

  async protectionLevel(): Promise<"OS_PROTECTED" | null> {
    return this.adapter.protectionLevel ? this.adapter.protectionLevel() : null;
  }

  namespace(userId: string) {
    return `linqa.account.${userId}`;
  }

  put(userId: string, key: string, value: string) {
    return this.adapter.put(this.namespace(userId), key, value);
  }

  get(userId: string, key: string) {
    return this.adapter.get(this.namespace(userId), key);
  }

  remove(userId: string, key: string) {
    return this.adapter.remove(this.namespace(userId), key);
  }

  destroyAccount(userId: string) {
    return this.adapter.destroyNamespace(this.namespace(userId));
  }
}

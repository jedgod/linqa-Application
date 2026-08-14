export interface SecureKeyStore {
  createKey(alias: string, requireUserPresence: boolean): Promise<void>;
  sign(alias: string, payload: Uint8Array): Promise<Uint8Array>;
  unwrap(alias: string, wrappedKey: Uint8Array): Promise<Uint8Array>;
  delete(alias: string): Promise<void>;
  exists(alias: string): Promise<boolean>;
}

/**
 * Platform adapters must use:
 * - Android Keystore with hardware-backed keys where available
 * - iOS Keychain/Secure Enclave
 * - Windows DPAPI/Hello-backed storage
 * - macOS Keychain/Secure Enclave
 *
 * Private keys must never be returned to JavaScript.
 */
export class FailClosedSecureKeyStore implements SecureKeyStore {
  async createKey(): Promise<void> {
    throw new Error("Native secure key store is not configured.");
  }
  async sign(): Promise<Uint8Array> {
    throw new Error("Native secure key store is not configured.");
  }
  async unwrap(): Promise<Uint8Array> {
    throw new Error("Native secure key store is not configured.");
  }
  async delete(): Promise<void> {
    throw new Error("Native secure key store is not configured.");
  }
  async exists(): Promise<boolean> {
    return false;
  }
}

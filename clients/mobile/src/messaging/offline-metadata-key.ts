import { getRandomBytesAsync } from "expo-crypto";
import { AccountSecureStorage } from "../../account/AccountSecureStorage";
import { base64ToBytes, bytesToBase64 } from "../../services/secure-core";

const pending = new Map<string, Promise<Uint8Array>>();
/** Serialize provisioning so simultaneous screens cannot overwrite the same account's key. */
export function loadOfflineMetadataKey(accountId: string): Promise<Uint8Array> {
  const existing = pending.get(accountId);
  if (existing) return existing;
  const task = (async () => {
    const store = new AccountSecureStorage();
    if (await store.protectionLevel() !== "OS_PROTECTED") throw new Error("OFFLINE_METADATA_SECURE_STORAGE_REQUIRED");
    const saved = await store.get(accountId, "outbox.metadataKey.v1");
    if (saved) {
      const key = base64ToBytes(saved);
      if (key.length !== 32) throw new Error("OFFLINE_METADATA_KEY_INVALID");
      return key;
    }
    const key = await getRandomBytesAsync(32);
    await store.put(accountId, "outbox.metadataKey.v1", bytesToBase64(key));
    return key;
  })();
  pending.set(accountId, task);
  void task.finally(() => { pending.delete(accountId); }).catch(() => undefined);
  return task;
}

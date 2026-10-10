import { requireNativeModule } from "expo-modules-core";

export type DeviceKeys = {
  userId: string;
  identityKey: string;
  signedPreKey: string;
  signature: string;
};

type NativeCore = {
  isAvailable: () => boolean;
  generateKeys: (userId: string) => Promise<DeviceKeys>;
  publishKeys: (keys: DeviceKeys) => Promise<void>;
  hasRemoteKeys: (userId: string) => Promise<boolean>;
  encrypt: (peerId: string, plaintext: string) => Promise<string>;
  decrypt: (peerId: string, ciphertext: string) => Promise<string>;
};

const native = requireNativeModule<NativeCore>("LinqaSecureCore");

export function assertNativeCrypto() {
  if (!native.isAvailable()) {
    throw new Error("Linqa secure core is not in this binary. Expo Go cannot send.");
  }
}

export async function ensureKeys(userId: string, upload: (keys: DeviceKeys) => Promise<void>) {
  assertNativeCrypto();
  const keys = await native.generateKeys(userId);
  await upload(keys);
  await native.publishKeys(keys);
  return keys;
}

export async function sendEncrypted(
  peerId: string,
  plaintext: string,
  lookupRemote: (userId: string) => Promise<boolean>,
) {
  assertNativeCrypto();
  const ready = await lookupRemote(peerId);
  if (!ready) throw new Error("Peer has no published encryption keys");
  return native.encrypt(peerId, plaintext);
}

export async function readEncrypted(peerId: string, ciphertext: string) {
  assertNativeCrypto();
  return native.decrypt(peerId, ciphertext);
}

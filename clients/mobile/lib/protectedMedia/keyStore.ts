// Keeps each protected photo's decryption key in the device keychain/keystore,
// separate from your chat history, so it can be destroyed once the photo closes.
//
// Recipient: call rememberMediaKey(payload) when the linqa-core message arrives,
// then store the message WITHOUT the key/nonce fields in your normal message store.

import * as SecureStore from 'expo-secure-store';
import type { MediaKey } from './crypto';

const slot = (mediaId: string) => `linqa_pm_${mediaId.replace(/[^A-Za-z0-9._-]/g, '')}`;

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function rememberMediaKey(mediaId: string, secret: MediaKey) {
  await SecureStore.setItemAsync(slot(mediaId), JSON.stringify(secret), OPTIONS);
}

const doneSlot = (mediaId: string) => `${slot(mediaId)}_done`;

/**
 * Saves the key the first time a message is opened. Once the key has been destroyed (viewed, expired or revoked)
 * the message is decrypted again whenever the chat reloads, so a marker stops that from bringing the key back.
 */
export async function rememberMediaKeyOnce(mediaId: string, secret: MediaKey) {
  if (await SecureStore.getItemAsync(doneSlot(mediaId), OPTIONS)) return;
  if (await SecureStore.getItemAsync(slot(mediaId), OPTIONS)) return;
  await rememberMediaKey(mediaId, secret);
}

export async function getMediaKey(mediaId: string): Promise<MediaKey | null> {
  const raw = await SecureStore.getItemAsync(slot(mediaId), OPTIONS);
  return raw ? (JSON.parse(raw) as MediaKey) : null;
}

export async function forgetMediaKey(mediaId: string) {
  await SecureStore.setItemAsync(doneSlot(mediaId), '1', OPTIONS);
  await SecureStore.deleteItemAsync(slot(mediaId), OPTIONS);
}

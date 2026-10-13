// Sender pipeline: strip metadata and resize → encrypt on device → upload
// ciphertext → return the payload to send inside your linqa-core message.

import { File, Paths } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { createProtectedMedia, type ProtectedMediaInfo } from './api';
import { encryptMedia, type MediaKey } from './crypto';
import type { ProtectionPolicy } from './policy';

const MAX_EDGE = 2048;

/**
 * The content of the end-to-end encrypted message that carries a protected photo.
 * Send it with linqa-core like any other structured message.
 */
export type ProtectedMediaPayload = {
  type: 'protected_media';
  v: 1;
  mediaId: string;
  secret: MediaKey;
  mime: 'image/jpeg';
  width: number;
  height: number;
  mode: ProtectionPolicy['mode'];
  /** Copied so the bubble can render before the first status fetch. */
  maxViews: number | null;
  windowSeconds: number | null;
  expiryStart: 'ON_SEND' | 'ON_FIRST_VIEW' | null;
};

function deleteQuietly(uri: string | null | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

export async function sendProtectedPhoto(args: {
  image: { uri: string; width: number; height: number };
  recipientId: string;
  conversationId: string;
  policy: ProtectionPolicy;
}): Promise<{ payload: ProtectedMediaPayload; info: ProtectedMediaInfo }> {
  const { image } = args;

  // Re-encoding to JPEG drops EXIF (GPS location, camera, timestamps).
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const actions = scale < 1
    ? [{ resize: { width: Math.round(image.width * scale), height: Math.round(image.height * scale) } }]
    : [];
  const clean = await ImageManipulator.manipulateAsync(image.uri, actions, {
    compress: 0.82,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  let tempCipherUri: string | null = null;
  try {
    const plain = await new File(clean.uri).bytes();
    const { ciphertext, secret } = encryptMedia(plain);
    plain.fill(0);

    const tmp = new File(Paths.cache, `pm-${Crypto.randomUUID()}.bin`);
    tmp.create();
    tmp.write(ciphertext);
    tempCipherUri = tmp.uri;

    const info = await createProtectedMedia({
      fileUri: tmp.uri,
      recipientId: args.recipientId,
      conversationId: args.conversationId,
      policy: args.policy,
    });

    const payload: ProtectedMediaPayload = {
      type: 'protected_media',
      v: 1,
      mediaId: info.id,
      secret,
      mime: 'image/jpeg',
      width: clean.width,
      height: clean.height,
      mode: info.mode,
      maxViews: info.maxViews,
      windowSeconds: info.windowSeconds,
      expiryStart: info.expiryStart,
    };
    return { payload, info };
  } finally {
    // Plaintext copies on disk are removed as soon as possible.
    deleteQuietly(clean.uri);
    deleteQuietly(tempCipherUri);
  }
}

/** Removes the picker's cached copy of the original photo (only inside this app's cache). */
export function discardPickedCopy(uri: string) {
  if (uri.startsWith(Paths.cache.uri)) deleteQuietly(uri);
}

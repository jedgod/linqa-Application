// Photo encryption: a fresh random 256-bit key per photo, XChaCha20-Poly1305
// (the same AEAD linqa-core uses). The server only ever receives ciphertext;
// the key goes to the recipient inside the end-to-end encrypted message.
//
// If linqa-core exposes an AEAD to JS, you can swap these two functions for it.

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { base64 } from '@scure/base';
import * as Crypto from 'expo-crypto';

const AAD = new TextEncoder().encode('linqa/protected-media/v1');

export type MediaKey = { key: string; nonce: string }; // base64

export function encryptMedia(plaintext: Uint8Array): { ciphertext: Uint8Array; secret: MediaKey } {
  const key = Crypto.getRandomBytes(32);
  const nonce = Crypto.getRandomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce, AAD).encrypt(plaintext);
  const secret = { key: base64.encode(key), nonce: base64.encode(nonce) };
  key.fill(0);
  return { ciphertext, secret };
}

/** Throws if the ciphertext was altered or the key is wrong. */
export function decryptMedia(ciphertext: Uint8Array, secret: MediaKey): Uint8Array {
  const key = base64.decode(secret.key);
  try {
    return xchacha20poly1305(key, base64.decode(secret.nonce), AAD).decrypt(ciphertext);
  } finally {
    key.fill(0);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  return base64.encode(bytes);
}

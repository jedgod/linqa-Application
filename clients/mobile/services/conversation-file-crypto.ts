import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { MAX_MEDIA_BYTES } from "./conversation-media";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { base64ToBytes, bytesToBase64, utf8 } from "./secure-core";
export type MediaContext = { conversationId: string; senderUserId: string; mediaId: string; mimeType: string };
export const mediaDigest = (envelope: string) => bytesToHex(sha256(base64ToBytes(envelope)));
const aad = (c: MediaContext) => utf8(JSON.stringify(["linqa:conversation-media:v1",c.conversationId,c.senderUserId,c.mediaId,c.mimeType]));
export function encryptMediaBytes(data: string, context: MediaContext, key: Uint8Array, nonce: Uint8Array): { envelope: string; key: string } {
  if (key.length !== 32 || nonce.length !== 24) throw new Error("Invalid media key");
  const plain = base64ToBytes(data);
  try {
    const encrypted = xchacha20poly1305(key,nonce,aad(context)).encrypt(plain);
    const envelope = new Uint8Array(nonce.length + encrypted.length); envelope.set(nonce); envelope.set(encrypted,nonce.length);
    return { envelope: bytesToBase64(envelope), key: bytesToBase64(key) };
  } finally { plain.fill(0); }
}
export function decryptMediaBytes(envelope: string, keyBase64: string, context: MediaContext): string {
  const key = base64ToBytes(keyBase64); const bytes = base64ToBytes(envelope);
  if (key.length !== 32 || bytes.length < 41 || bytes.length > MAX_MEDIA_BYTES+40) throw new Error("Invalid media");
  let plain: Uint8Array | undefined;
  try { plain = xchacha20poly1305(key,bytes.subarray(0,24),aad(context)).decrypt(bytes.subarray(24)); return bytesToBase64(plain); }
  finally { key.fill(0); plain?.fill(0); }
}
export async function sealMedia(data: string, context: MediaContext) {
  const { getRandomBytesAsync } = await import("expo-crypto");
  const key = await getRandomBytesAsync(32); const nonce = await getRandomBytesAsync(24);
  try { return encryptMediaBytes(data,context,key,nonce); } finally { key.fill(0); }
}

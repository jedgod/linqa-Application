/**
 * Device-side seal used by the share pipeline.
 * Swap `seal` / `open` for the Linqa session ratchet (X3DH + Double Ratchet).
 * The contract stays the same: callers never put attachment bytes on the wire.
 */

const encoder = new TextEncoder();

export interface SealedBlob {
  v: 1;
  alg: "linqa-device-seal-v1";
  nonce: string;
  ciphertext: string;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function keyFromThread(threadKey: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(threadKey));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(plaintext: Uint8Array, threadKey: string): Promise<SealedBlob> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromThread(threadKey);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext),
  );
  return {
    v: 1,
    alg: "linqa-device-seal-v1",
    nonce: bytesToB64(nonce),
    ciphertext: bytesToB64(ciphertext),
  };
}

export async function open(blob: SealedBlob, threadKey: string): Promise<Uint8Array> {
  const key = await keyFromThread(threadKey);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(blob.nonce) },
    key,
    b64ToBytes(blob.ciphertext),
  );
  return new Uint8Array(plain);
}

/** JSON attachments (poll, event, meeting, contact, location, metadata). */
export async function sealJson(value: unknown, threadKey: string): Promise<string> {
  const blob = await seal(encoder.encode(JSON.stringify(value)), threadKey);
  return JSON.stringify(blob);
}

export function bufferToB64(buffer: ArrayBuffer): string {
  return bytesToB64(new Uint8Array(buffer));
}

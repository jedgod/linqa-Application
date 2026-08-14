import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

const DOMAIN = new TextEncoder().encode("linqa:device-enrollment:v1");

export type DeviceKeyPair = {
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  encryptionPrivateKey: Uint8Array;
  encryptionPublicKey: Uint8Array;
};

export function generateDeviceKeyPair(): DeviceKeyPair {
  const signing = ed25519.keygen();
  const encryption = x25519.keygen();
  return {
    signingPrivateKey: signing.secretKey,
    signingPublicKey: signing.publicKey,
    encryptionPrivateKey: encryption.secretKey,
    encryptionPublicKey: encryption.publicKey
  };
}

export function restoreDeviceKeyPair(signingPrivateKey: Uint8Array, encryptionPrivateKey: Uint8Array): DeviceKeyPair {
  return {
    signingPrivateKey,
    signingPublicKey: ed25519.getPublicKey(signingPrivateKey),
    encryptionPrivateKey,
    encryptionPublicKey: x25519.getPublicKey(encryptionPrivateKey)
  };
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function bigIntBE8(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Byte-for-byte match of server/src/auth/enrollment-proof.ts's
 * canonicalEnrollmentDigest (itself a reimplementation of
 * core/src/enrollment.rs's canonical_bytes) — field order, raw-bytes
 * encoding (no length prefixes), and the expiry-as-big-endian-int64-seconds
 * layout must stay in lockstep with it, or the server will reject every
 * proof this produces.
 */
export function canonicalEnrollmentDigest(input: {
  challengeId: string;
  userId: string;
  nonce: Uint8Array;
  expiresAtUnix: bigint;
  deviceName: string;
  platform: string;
  signingPublicKey: Uint8Array;
  encryptionPublicKey: Uint8Array;
}): Uint8Array {
  const encoder = new TextEncoder();
  const bytes = concatBytes(
    DOMAIN,
    encoder.encode(input.challengeId),
    encoder.encode(input.userId),
    input.nonce,
    bigIntBE8(input.expiresAtUnix),
    encoder.encode(input.deviceName),
    encoder.encode(input.platform),
    input.signingPublicKey,
    input.encryptionPublicKey
  );
  return sha256(bytes);
}

export function signEnrollmentProof(digest: Uint8Array, signingPrivateKey: Uint8Array): Uint8Array {
  return ed25519.sign(digest, signingPrivateKey);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

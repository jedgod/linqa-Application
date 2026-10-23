import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

/**
 * On-device encryption for Notes and Calendar. The server stores and returns only what this file produces, so it can't
 * read a note or an event's details. The key is derived from the account's vault key, which never leaves this phone: if the
 * vault key is lost, these items can't be opened again. Each ciphertext is `nonce(24) || sealed`, and its kind is bound in as
 * associated data so a note can't be passed off as an event title or the other way round.
 */
export type SealedKind = "note" | "event" | "event-description";

const text = new TextEncoder();
const aad = (kind: SealedKind) => text.encode(`linqa:workspace:${kind}:v1`);

/** A key for Notes and Calendar only, so the vault key itself is never used to encrypt them directly. */
export function workspaceKey(vaultKey: Uint8Array): Uint8Array {
  if (vaultKey.length !== 32) throw new Error("The vault key is not valid.");
  return hkdf(sha256, vaultKey, undefined, text.encode("linqa:workspace:v1"), 32);
}

/** `random(n)` supplies n secure random bytes (24 are used for the nonce). */
export function sealJson(key: Uint8Array, kind: SealedKind, value: unknown, random: (n: number) => Uint8Array): Uint8Array {
  const nonce = random(24);
  if (nonce.length !== 24) throw new Error("Not enough randomness to encrypt.");
  const sealed = xchacha20poly1305(key, nonce, aad(kind)).encrypt(text.encode(JSON.stringify(value)));
  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce);
  out.set(sealed, nonce.length);
  return out;
}

export function openJson<T>(key: Uint8Array, kind: SealedKind, boxed: Uint8Array): T {
  if (boxed.length < 24 + 16) throw new Error("This item is damaged and can't be opened.");
  try {
    return JSON.parse(new TextDecoder().decode(xchacha20poly1305(key, boxed.subarray(0, 24), aad(kind)).decrypt(boxed.subarray(24)))) as T;
  } catch {
    // A wrong key, a different kind, or altered bytes all end here. Nothing about the content is revealed.
    throw new Error("This item can't be opened on this device.");
  }
}

/** Base64 for ciphertext on the wire. Uses atob/btoa, which Hermes and Node both provide. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

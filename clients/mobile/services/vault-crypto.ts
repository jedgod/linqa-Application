import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { utf8 } from "./secure-core";

/**
 * On-device encryption for LinqaVault items. The server only ever receives ciphertext:
 *
 *   - the file is encrypted with a fresh random file key (XChaCha20-Poly1305),
 *   - the file's name and details are encrypted with the same file key,
 *   - the file key is wrapped with the account's vault key, which never leaves this phone.
 *
 * Each ciphertext is `nonce(24) || sealed`. The labels below are bound in as associated data, so a name cannot be passed off as
 * file content or the other way round.
 */

export interface VaultItemDetails { name: string; mimeType: string; kind: "PHOTO" | "VIDEO" | "VOICE" | "FILE"; size: number; createdAt: string }

export interface SealedVaultItem {
  content: Uint8Array;
  name: Uint8Array;
  details: Uint8Array;
  keyEnvelope: Uint8Array;
  contentHash: Uint8Array;
}

const AAD = { content: utf8("linqa:vault:content:v1"), name: utf8("linqa:vault:name:v1"), details: utf8("linqa:vault:details:v1"), wrap: utf8("linqa:vault:keywrap:v1") };

function seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plain: Uint8Array): Uint8Array {
  const sealed = xchacha20poly1305(key, nonce, aad).encrypt(plain);
  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce);
  out.set(sealed, nonce.length);
  return out;
}

function open(key: Uint8Array, aad: Uint8Array, boxed: Uint8Array): Uint8Array {
  if (boxed.length < 24 + 16) throw new Error("The vault item is damaged.");
  return xchacha20poly1305(key, boxed.subarray(0, 24), aad).decrypt(boxed.subarray(24));
}

/** `random(n)` supplies n secure random bytes: 32 for the file key, then 24 for each nonce (four of them). */
export function sealVaultItem(plain: Uint8Array, details: VaultItemDetails, vaultKey: Uint8Array, random: (n: number) => Uint8Array): SealedVaultItem {
  if (vaultKey.length !== 32) throw new Error("The vault key is not valid.");
  const fileKey = random(32);
  try {
    const content = seal(fileKey, random(24), AAD.content, plain);
    return {
      content,
      name: seal(fileKey, random(24), AAD.name, utf8(details.name)),
      details: seal(fileKey, random(24), AAD.details, utf8(JSON.stringify(details))),
      keyEnvelope: seal(vaultKey, random(24), AAD.wrap, fileKey),
      contentHash: sha256(content)
    };
  } finally {
    fileKey.fill(0);
  }
}

export function openVaultItem(item: Pick<SealedVaultItem, "content" | "keyEnvelope" | "contentHash">, vaultKey: Uint8Array): Uint8Array {
  const digest = sha256(item.content);
  if (digest.length !== item.contentHash.length || digest.some((byte, index) => byte !== item.contentHash[index])) throw new Error("The vault item does not match its checksum.");
  const fileKey = open(vaultKey, AAD.wrap, item.keyEnvelope);
  try {
    return open(fileKey, AAD.content, item.content);
  } finally {
    fileKey.fill(0);
  }
}

export function openVaultName(name: Uint8Array, keyEnvelope: Uint8Array, vaultKey: Uint8Array): string {
  const fileKey = open(vaultKey, AAD.wrap, keyEnvelope);
  try {
    return new TextDecoder().decode(open(fileKey, AAD.name, name));
  } finally {
    fileKey.fill(0);
  }
}

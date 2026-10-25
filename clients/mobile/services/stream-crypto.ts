import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

/**
 * Chunked authenticated encryption for large recordings (a podcast can run 30 minutes, far past the 25 MB the whole-file
 * adapter allows). The file is cut into fixed-size plaintext chunks; each is sealed on its own, so a phone never holds more than
 * one chunk, and each sealed chunk is exactly one S3 multipart part on the server (parts must be at least 5 MiB, and a chunk is).
 *
 * What the server (or anyone holding only the ciphertext) can and cannot do:
 *  - It cannot read anything: the key and nonce prefix travel only inside the per-recipient sealed key bundle.
 *  - It cannot truncate, extend, reorder, duplicate or swap chunks, or move them to another recording: every chunk's AAD binds the
 *    recording id, owner, MIME type, chunk size, total chunk count and this chunk's index, all of which the recipient reads from
 *    the sealed bundle, not from the server. Any mismatch fails authentication.
 *  - It cannot alter a byte: Poly1305 authenticates each chunk.
 * Nothing here is random per chunk; the 24-byte nonce is the bundle's 16-byte random prefix followed by the 8-byte chunk index,
 * and a recording uses a fresh random key, so no (key, nonce) pair is ever reused.
 */

/** 5 MiB of plaintext per chunk -> a 5 MiB + 16 byte ciphertext chunk, which satisfies S3's 5 MiB minimum part size. */
export const STREAM_CHUNK_BYTES = 5 * 1024 * 1024;
export const STREAM_TAG_BYTES = 16;
export const STREAM_KEY_BYTES = 32;
export const STREAM_NONCE_PREFIX_BYTES = 16;
/** The server accepts at most 10,000 parts and 500 MiB of ciphertext per upload. */
export const MAX_STREAM_CHUNKS = 10_000;
export const MAX_STREAM_CIPHERTEXT_BYTES = 500 * 1024 * 1024;

export class StreamCryptoError extends Error {
  constructor(public readonly code: "INVALID_PARAMS" | "INVALID_CHUNK" | "AUTHENTICATION_FAILED" | "TOO_LARGE") {
    super(code);
    this.name = "StreamCryptoError";
  }
}

/** Everything a recipient needs to open a recording. This is what gets sealed to each recipient device. */
export interface StreamParams {
  mediaId: string;
  ownerUserId: string;
  mime: string;
  /** Plaintext bytes per chunk (all but the last chunk are exactly this long). */
  chunkSize: number;
  chunkCount: number;
  plaintextSize: number;
  key: Uint8Array;
  noncePrefix: Uint8Array;
}

const enc = new TextEncoder();

export function chunkCountFor(plaintextSize: number, chunkSize = STREAM_CHUNK_BYTES): number {
  if (!Number.isSafeInteger(plaintextSize) || plaintextSize <= 0 || !Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new StreamCryptoError("INVALID_PARAMS");
  return Math.ceil(plaintextSize / chunkSize);
}

/** The exact ciphertext size for a plaintext size, so the upload can be declared before any chunk is sealed. */
export function ciphertextSizeFor(plaintextSize: number, chunkSize = STREAM_CHUNK_BYTES): number {
  return plaintextSize + chunkCountFor(plaintextSize, chunkSize) * STREAM_TAG_BYTES;
}

/** Fails if the parameters could not describe a real recording (also validates what came out of a sealed bundle). */
export function assertParams(p: StreamParams): void {
  const ok =
    typeof p.mediaId === "string" && p.mediaId.length > 0 && p.mediaId.length <= 128 &&
    typeof p.ownerUserId === "string" && p.ownerUserId.length > 0 && p.ownerUserId.length <= 128 &&
    typeof p.mime === "string" && p.mime.length > 0 && p.mime.length <= 100 &&
    p.key instanceof Uint8Array && p.key.length === STREAM_KEY_BYTES &&
    p.noncePrefix instanceof Uint8Array && p.noncePrefix.length === STREAM_NONCE_PREFIX_BYTES &&
    Number.isSafeInteger(p.chunkSize) && p.chunkSize > 0 && p.chunkSize <= STREAM_CHUNK_BYTES &&
    Number.isSafeInteger(p.plaintextSize) && p.plaintextSize > 0 &&
    Number.isSafeInteger(p.chunkCount) && p.chunkCount >= 1 && p.chunkCount <= MAX_STREAM_CHUNKS &&
    p.chunkCount === Math.ceil(p.plaintextSize / p.chunkSize);
  if (!ok) throw new StreamCryptoError("INVALID_PARAMS");
  if (ciphertextSizeFor(p.plaintextSize, p.chunkSize) > MAX_STREAM_CIPHERTEXT_BYTES) throw new StreamCryptoError("TOO_LARGE");
}

/** The plaintext length of chunk `index`: full-size for every chunk but the last. */
export function plaintextLengthOf(p: StreamParams, index: number): number {
  return index === p.chunkCount - 1 ? p.plaintextSize - p.chunkSize * (p.chunkCount - 1) : p.chunkSize;
}

function nonceFor(p: StreamParams, index: number): Uint8Array {
  const nonce = new Uint8Array(24);
  nonce.set(p.noncePrefix, 0);
  new DataView(nonce.buffer).setBigUint64(16, BigInt(index), false);
  return nonce;
}

function aadFor(p: StreamParams, index: number): Uint8Array {
  return enc.encode(JSON.stringify(["linqa:stream:v1", p.mediaId, p.ownerUserId, p.mime, p.chunkSize, p.chunkCount, index]));
}

function assertIndex(p: StreamParams, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= p.chunkCount) throw new StreamCryptoError("INVALID_CHUNK");
}

export function encryptChunk(p: StreamParams, index: number, plaintext: Uint8Array): Uint8Array {
  assertParams(p);
  assertIndex(p, index);
  if (plaintext.length !== plaintextLengthOf(p, index)) throw new StreamCryptoError("INVALID_CHUNK");
  return xchacha20poly1305(p.key, nonceFor(p, index), aadFor(p, index)).encrypt(plaintext);
}

export function decryptChunk(p: StreamParams, index: number, ciphertext: Uint8Array): Uint8Array {
  assertParams(p);
  assertIndex(p, index);
  if (ciphertext.length !== plaintextLengthOf(p, index) + STREAM_TAG_BYTES) throw new StreamCryptoError("INVALID_CHUNK");
  try {
    return xchacha20poly1305(p.key, nonceFor(p, index), aadFor(p, index)).decrypt(ciphertext);
  } catch {
    throw new StreamCryptoError("AUTHENTICATION_FAILED");
  }
}

/**
 * The manifest hash the upload API asks for: SHA-256 over each sealed chunk's SHA-256 in order, so the server can bind the
 * finished object to exactly these chunks without learning anything about them.
 */
export function manifestHash(chunkHashes: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(chunkHashes.length * 32);
  chunkHashes.forEach((h, i) => { if (h.length !== 32) throw new StreamCryptoError("INVALID_PARAMS"); joined.set(h, i * 32); });
  return sha256(joined);
}

export const hashChunk = (ciphertext: Uint8Array): Uint8Array => sha256(ciphertext);

/** A fresh key and nonce prefix from the caller's secure random source (expo-crypto on the phone, node:crypto in tests). */
export function newStreamSecrets(random: (n: number) => Uint8Array): { key: Uint8Array; noncePrefix: Uint8Array } {
  return { key: random(STREAM_KEY_BYTES), noncePrefix: random(STREAM_NONCE_PREFIX_BYTES) };
}

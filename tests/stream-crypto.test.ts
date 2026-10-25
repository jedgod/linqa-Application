import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  MAX_STREAM_CHUNKS, STREAM_CHUNK_BYTES, STREAM_TAG_BYTES, StreamCryptoError, assertParams, chunkCountFor, ciphertextSizeFor,
  decryptChunk, encryptChunk, hashChunk, manifestHash, newStreamSecrets, plaintextLengthOf, type StreamParams
} from "../clients/mobile/services/stream-crypto.ts";

const rand = (n: number) => new Uint8Array(randomBytes(n));
// Small chunks keep the tests fast; the format is identical at any chunk size up to STREAM_CHUNK_BYTES.
const CHUNK = 1024;

function params(plaintextSize: number, over: Partial<StreamParams> = {}): StreamParams {
  return {
    mediaId: "11111111-1111-4111-8111-111111111111", ownerUserId: "22222222-2222-4222-8222-222222222222", mime: "video/mp4",
    chunkSize: CHUNK, chunkCount: chunkCountFor(plaintextSize, CHUNK), plaintextSize, ...newStreamSecrets(rand), ...over
  };
}
const code = (fn: () => unknown) => { try { fn(); return "NO_ERROR"; } catch (e) { return e instanceof StreamCryptoError ? e.code : `OTHER:${(e as Error).message}`; } };

/** Seal a whole buffer the way the uploader does: chunk by chunk. */
function sealAll(p: StreamParams, data: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < p.chunkCount; i++) out.push(encryptChunk(p, i, data.subarray(i * p.chunkSize, i * p.chunkSize + plaintextLengthOf(p, i))));
  return out;
}
const openAll = (p: StreamParams, chunks: Uint8Array[]) => {
  const parts = chunks.map((c, i) => decryptChunk(p, i, c));
  const joined = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let at = 0; for (const x of parts) { joined.set(x, at); at += x.length; }
  return joined;
};

test("a recording round-trips chunk by chunk, including a short last chunk and an exact multiple", () => {
  for (const size of [1, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 3, CHUNK * 3 + 7, CHUNK * 10 + 1]) {
    const data = rand(size);
    const p = params(size);
    const sealed = sealAll(p, data);
    assert.equal(sealed.length, p.chunkCount, `chunk count for ${size}`);
    assert.equal(sealed.reduce((n, c) => n + c.length, 0), ciphertextSizeFor(size, CHUNK), `ciphertext size for ${size}`);
    assert.deepEqual(openAll(p, sealed), data, `round trip for ${size}`);
  }
});

test("every full ciphertext chunk at the real chunk size is at least 5 MiB, so each is one valid S3 multipart part", () => {
  assert.ok(STREAM_CHUNK_BYTES + STREAM_TAG_BYTES >= 5 * 1024 * 1024);
  const p = params(STREAM_CHUNK_BYTES * 2 + 5, { chunkSize: STREAM_CHUNK_BYTES, chunkCount: 3 });
  assertParams(p);
  const sealed = encryptChunk(p, 0, rand(STREAM_CHUNK_BYTES));
  assert.equal(sealed.length, STREAM_CHUNK_BYTES + STREAM_TAG_BYTES);
});

test("nothing readable survives in the ciphertext and two recordings of the same bytes differ", () => {
  const data = new Uint8Array(CHUNK * 2).fill(0x41);
  const a = sealAll(params(data.length), data);
  const b = sealAll(params(data.length), data);
  assert.notDeepEqual(a[0], b[0], "fresh key and nonce prefix per recording");
  // identical plaintext chunks inside one recording also seal differently (the index is in the nonce)
  assert.notDeepEqual(a[0], a[1]);
  assert.ok(!Buffer.from(a[0]!).includes(Buffer.from("AAAAAAAA")));
});

test("any flipped byte in any chunk fails authentication", () => {
  const data = rand(CHUNK * 3 + 5);
  const p = params(data.length);
  const sealed = sealAll(p, data);
  for (let i = 0; i < sealed.length; i++) {
    for (const at of [0, Math.floor(sealed[i]!.length / 2), sealed[i]!.length - 1]) {
      const bad = sealed[i]!.slice(); bad[at] = bad[at]! ^ 0x01;
      assert.equal(code(() => decryptChunk(p, i, bad)), "AUTHENTICATION_FAILED", `chunk ${i} byte ${at}`);
    }
  }
});

test("a server cannot reorder or duplicate chunks", () => {
  const data = rand(CHUNK * 4);
  const p = params(data.length);
  const sealed = sealAll(p, data);
  assert.equal(code(() => decryptChunk(p, 1, sealed[2]!)), "AUTHENTICATION_FAILED", "chunk 2 presented as chunk 1");
  assert.equal(code(() => decryptChunk(p, 0, sealed[1]!)), "AUTHENTICATION_FAILED", "chunk 1 presented as chunk 0");
  assert.equal(code(() => decryptChunk(p, 3, sealed[0]!)), "AUTHENTICATION_FAILED", "chunk 0 presented as the last chunk");
});

test("a server cannot truncate or extend a recording: the chunk count is authenticated", () => {
  const data = rand(CHUNK * 4);
  const p = params(data.length);
  const sealed = sealAll(p, data);
  // The recipient believes the recording is 3 chunks (the server dropped the last): every chunk now fails, not just the missing one.
  const shorter = { ...p, chunkCount: 3, plaintextSize: CHUNK * 3 };
  for (let i = 0; i < 3; i++) assert.equal(code(() => decryptChunk(shorter, i, sealed[i]!)), "AUTHENTICATION_FAILED", `chunk ${i} under a shortened count`);
  // ...and the same when the server claims extra chunks.
  const longer = { ...p, chunkCount: 5, plaintextSize: CHUNK * 5 };
  assert.equal(code(() => decryptChunk(longer, 0, sealed[0]!)), "AUTHENTICATION_FAILED");
});

test("chunks cannot be moved to another recording, owner or MIME type, and a wrong key fails", () => {
  const data = rand(CHUNK * 2);
  const p = params(data.length);
  const sealed = sealAll(p, data);
  assert.equal(code(() => decryptChunk({ ...p, mediaId: "33333333-3333-4333-8333-333333333333" }, 0, sealed[0]!)), "AUTHENTICATION_FAILED");
  assert.equal(code(() => decryptChunk({ ...p, ownerUserId: "44444444-4444-4444-8444-444444444444" }, 0, sealed[0]!)), "AUTHENTICATION_FAILED");
  assert.equal(code(() => decryptChunk({ ...p, mime: "audio/mp4" }, 0, sealed[0]!)), "AUTHENTICATION_FAILED");
  assert.equal(code(() => decryptChunk({ ...p, key: rand(32) }, 0, sealed[0]!)), "AUTHENTICATION_FAILED");
  assert.equal(code(() => decryptChunk({ ...p, noncePrefix: rand(16) }, 0, sealed[0]!)), "AUTHENTICATION_FAILED");
});

test("malformed input is refused before any crypto happens", () => {
  const p = params(CHUNK * 2);
  assert.equal(code(() => encryptChunk(p, 0, rand(CHUNK - 1))), "INVALID_CHUNK", "wrong plaintext length");
  assert.equal(code(() => encryptChunk(p, 2, rand(CHUNK))), "INVALID_CHUNK", "index past the end");
  assert.equal(code(() => encryptChunk(p, -1, rand(CHUNK))), "INVALID_CHUNK");
  assert.equal(code(() => decryptChunk(p, 0, rand(5))), "INVALID_CHUNK", "ciphertext too short");
  assert.equal(code(() => decryptChunk(p, 0, rand(CHUNK))), "INVALID_CHUNK", "ciphertext missing its tag");
  assert.equal(code(() => assertParams({ ...p, key: rand(31) })), "INVALID_PARAMS");
  assert.equal(code(() => assertParams({ ...p, noncePrefix: rand(15) })), "INVALID_PARAMS");
  assert.equal(code(() => assertParams({ ...p, chunkCount: 5 })), "INVALID_PARAMS", "count must match the size");
  assert.equal(code(() => assertParams({ ...p, chunkSize: STREAM_CHUNK_BYTES + 1 })), "INVALID_PARAMS");
  assert.equal(code(() => assertParams({ ...p, mediaId: "" })), "INVALID_PARAMS");
  assert.equal(code(() => chunkCountFor(0)), "INVALID_PARAMS");
});

test("limits: at most 500 MiB of ciphertext and 10,000 chunks", () => {
  const big = params(0 + 600 * 1024 * 1024, { chunkSize: STREAM_CHUNK_BYTES, chunkCount: Math.ceil(600 * 1024 * 1024 / STREAM_CHUNK_BYTES) });
  assert.equal(code(() => assertParams(big)), "TOO_LARGE");
  assert.ok(MAX_STREAM_CHUNKS * STREAM_CHUNK_BYTES >= 500 * 1024 * 1024, "the chunk limit never binds before the size limit");
});

test("no keystream is reused: identical plaintext in different chunks encrypts to different bytes (tag excluded)", () => {
  const p = params(CHUNK * 3);
  const same = new Uint8Array(CHUNK).fill(7);
  // Compare only the encrypted body. The tag differs anyway (the index is in the AAD), which would hide a repeated keystream.
  const bodies = [0, 1, 2].map((i) => Buffer.from(encryptChunk(p, i, same).subarray(0, CHUNK)).toString("hex"));
  assert.equal(new Set(bodies).size, 3, "same key + same nonce on two chunks would leak the XOR of their plaintexts");
});

test("the manifest hash binds the exact sealed chunks in order", () => {
  const data = rand(CHUNK * 3);
  const p = params(data.length);
  const sealed = sealAll(p, data);
  const hashes = sealed.map(hashChunk);
  const m = manifestHash(hashes);
  assert.equal(m.length, 32);
  assert.deepEqual(manifestHash(hashes), m, "deterministic");
  assert.notDeepEqual(manifestHash([hashes[1]!, hashes[0]!, hashes[2]!]), m, "order matters");
  assert.notDeepEqual(manifestHash(hashes.slice(0, 2)), m, "dropping a chunk changes it");
  assert.equal(code(() => manifestHash([new Uint8Array(31)])), "INVALID_PARAMS");
});

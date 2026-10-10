import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openVaultItem, openVaultName, sealVaultItem } from "../services/vault-crypto.ts";

const random = (n) => new Uint8Array(randomBytes(n));
const details = { name: "voice-note.m4a", mimeType: "audio/mp4", kind: "VOICE", size: 5, createdAt: "2026-10-09T00:00:00Z" };

test("a vault item opens only with its own vault key and nothing readable is left in the ciphertext", () => {
  const key = random(32);
  const plain = new TextEncoder().encode("hello vault bytes");
  const sealed = sealVaultItem(plain, { ...details, size: plain.length }, key, random);
  assert.equal(Buffer.from(sealed.content).includes(Buffer.from("hello vault")), false);
  assert.equal(Buffer.from(sealed.name).includes(Buffer.from("voice-note")), false);
  assert.deepEqual(openVaultItem(sealed, key), plain);
  assert.equal(openVaultName(sealed.name, sealed.keyEnvelope, key), "voice-note.m4a");
  assert.throws(() => openVaultItem(sealed, random(32)));
});

test("a changed byte is rejected", () => {
  const key = random(32);
  const sealed = sealVaultItem(new Uint8Array([1, 2, 3, 4]), details, key, random);
  const tampered = { ...sealed, content: sealed.content.slice() };
  tampered.content[tampered.content.length - 1] ^= 1;
  assert.throws(() => openVaultItem(tampered, key));
});

test("a name cannot be opened as content", () => {
  const key = random(32);
  const sealed = sealVaultItem(new Uint8Array([9, 9, 9]), details, key, random);
  assert.throws(() => openVaultItem({ ...sealed, content: sealed.name, contentHash: new Uint8Array(32) }, key));
});

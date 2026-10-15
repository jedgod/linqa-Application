import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { OfflineMetadataCipher } from "../clients/mobile/src/messaging/offline-metadata.ts";
import { ProtectedMobileOutbox } from "../clients/mobile/src/messaging/protected-outbox.ts";
import type { MobileOutboxDb, MobileOutboxRow, MediaOutboxRow } from "../clients/mobile/src/messaging/outbox.ts";

const makeCipher = (key = randomBytes(32), account = "account-private") => new OfflineMetadataCipher(key, account, randomBytes);
test("AES-256-GCM metadata authenticates key, account, row, purpose, ciphertext and nonce", () => {
  const key = randomBytes(32), cipher = makeCipher(key);
  const box = cipher.seal({ conversation: "private-conversation" }, "message", "message-id");
  assert.deepEqual(cipher.open(box, "message", "message-id"), { conversation: "private-conversation" });
  assert.notEqual(cipher.seal({ conversation: "private-conversation" }, "message", "message-id"), box);
  for (const open of [() => makeCipher().open(box, "message", "message-id"), () => makeCipher(key, "another-account").open(box, "message", "message-id"),
    () => cipher.open(box, "media", "message-id"), () => cipher.open(box, "message", "another-message")]) assert.throws(open, /AUTHENTICATION_FAILED/);
  for (const property of ["iv", "ciphertext"]) {
    const changed = JSON.parse(box); const bytes = Buffer.from(changed[property], "base64"); bytes[0] ^= 1; changed[property] = bytes.toString("base64");
    assert.throws(() => cipher.open(JSON.stringify(changed), "message", "message-id"), /AUTHENTICATION_FAILED/);
  }
  assert.throws(() => makeCipher(new Uint8Array(16)), /KEY_INVALID/);
  assert.throws(() => cipher.open('{"v":2}', "message", "message-id"), /AUTHENTICATION_FAILED/);
});

function fixture() {
  const messages = new Map<string, MobileOutboxRow>(), media = new Map<string, MediaOutboxRow>();
  const raw: MobileOutboxDb = {
    transaction: async fn => fn(), insert: async row => { messages.set(row.messageId, { ...row }); },
    find: async id => messages.get(id) ?? null, due: async n => [...messages.values()].slice(0, n), pending: async n => [...messages.values()].slice(0, n),
    remove: async id => { messages.delete(id); media.delete(id); }, update: async (id, patch) => { Object.assign(messages.get(id)!, patch); },
    markPermanent: async (conversation, id, errorCode) => { const row = messages.get(id); if (row?.conversationId !== conversation) throw new Error("OUTBOX_MESSAGE_NOT_FOUND"); Object.assign(row, { state: "FAILED_PERMANENT", errorCode }); },
    listPermanent: async conversation => [...messages.values()].filter(r => r.conversationId === conversation && r.state === "FAILED_PERMANENT").map(r => ({ messageId: r.messageId, conversationId: r.conversationId, createdAt: r.createdAt!, errorCode: r.errorCode! })),
    deletePermanent: async (conversation, id) => { if (messages.get(id)?.conversationId === conversation) messages.delete(id); },
    putMedia: async row => { media.set(row.messageId, row); messages.set(row.messageId, { ...source, messageId: row.messageId, accountId: cipher.index("account", source.accountId), conversationId: row.conversationId, encryptedEnvelopeB64: row.ciphertext }); },
    findMedia: async id => media.get(id) ?? null
  };
  const cipher = makeCipher();
  return { db: new ProtectedMobileOutbox(raw, cipher, source.accountId), messages, media };
}
const source: MobileOutboxRow = { messageId: "id", accountId: "account-private", conversationId: "conversation-private", recipientDeviceId: "device-private", encryptedEnvelopeB64: "transport-envelope", state: "QUEUED", attempts: 0, nextAttemptAt: 100, createdAt: 90 };

test("outbox transparently seals identifiers and transport envelopes while retaining retries and failures", async () => {
  const { db, messages } = fixture();
  await db.insert(source);
  const stored = JSON.stringify(messages.get(source.messageId));
  for (const value of [source.accountId, source.conversationId, source.recipientDeviceId, source.encryptedEnvelopeB64]) assert.equal(stored.includes(value), false);
  assert.deepEqual(await db.find(source.messageId), { ...source, errorCode: undefined });
  await db.update(source.messageId, { attempts: 2, nextAttemptAt: 200 });
  assert.equal((await db.pending(10))[0].attempts, 2);
  await assert.rejects(db.update(source.messageId, { accountId: "another-account" }), /ISOLATION/);
  await db.markPermanent(source.conversationId, source.messageId, "RELAY_REJECTED");
  assert.equal((await db.find(source.messageId))?.errorCode, "RELAY_REJECTED");
  assert.equal((await db.listPermanent(source.conversationId))[0].conversationId, source.conversationId);
  await db.deletePermanent(source.conversationId, source.messageId);
  assert.equal(await db.find(source.messageId), null);
});

test("media retries restore exact E2EE bytes and reject changed content under the same id", async () => {
  const { db, media } = fixture();
  const row: MediaOutboxRow = { messageId: "media-message", conversationId: source.conversationId, deviceId: "private-device", mediaId: "private-media", envelope: "original-media-envelope", ciphertext: "original-message-envelope" };
  await db.putMedia(row); await db.putMedia(row);
  assert.deepEqual(await db.findMedia(row.messageId), row);
  assert.equal((await db.find(row.messageId))?.encryptedEnvelopeB64, row.ciphertext);
  const stored = JSON.stringify(media.get(row.messageId));
  for (const value of [row.deviceId, row.mediaId, row.envelope, row.ciphertext, row.conversationId]) assert.equal(stored.includes(value), false);
  await assert.rejects(db.putMedia({ ...row, envelope: "different" }), /MEDIA_ID_REUSE/);
});

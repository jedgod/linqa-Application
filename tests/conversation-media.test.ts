import { encryptMediaBytes, decryptMediaBytes } from "../clients/mobile/services/conversation-file-crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { ConversationService, unavailableSecureMessaging } from "../clients/mobile/services/conversation.service";
import { validatePayload, parseBody, MAX_TEXT } from "../clients/mobile/services/conversation-engine";
const payload = { type: "media" as const, mediaId: "11111111-1111-4111-8111-111111111111", mediaKind: "VOICE" as const, mimeType: "audio/mp4", localUri: "file:///private-recording.m4a" };
const crypto = { seal: async () => ({ envelope: "c2VhbGVk", key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }), open: () => "aGVsbG8=" };
const files = { read: async () => "aGVsbG8=", cache: async () => "file:///opened.m4a" };
test("media is sealed before upload and local paths never appear in transmitted messages", async () => {
 const requests: { path: string; body: string }[] = []; const plaintexts: string[] = [];
 const old = globalThis.fetch;
 globalThis.fetch = async (input, init) => { requests.push({ path: String(input), body: String(init?.body) }); return new Response(JSON.stringify({ id: "message-id" }), { status: 201 }); };
 try {
  const service = new ConversationService("http://test", async () => "token", "self", { seal: async text => { plaintexts.push(text); return Buffer.from("sealed-message-descriptor").toString("base64"); }, open: async () => "" }, files, crypto);
  await service.send("conversation", payload, "message-id");
  assert.match(requests[0]!.path, /media/); assert.deepEqual(JSON.parse(requests[0]!.body), { envelopeBase64: "c2VhbGVk" });
  assert.equal(JSON.parse(plaintexts[0]!).mediaKey, crypto.seal ? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" : "");
  assert.equal(JSON.parse(plaintexts[0]!).localUri, undefined); assert.equal(JSON.parse(plaintexts[0]!).data, undefined);
  assert.ok(requests.every(r => !r.body.includes("private-recording") && !r.body.includes("aGVsbG8=")));
 } finally { globalThis.fetch = old; }
});
test("missing encryption cannot upload plaintext or publish a media descriptor", async () => {
 let fetched = false; const old = globalThis.fetch;
 globalThis.fetch = async () => { fetched = true; return new Response("{}"); };
 try { const service = new ConversationService("http://test", async () => "token", "self", unavailableSecureMessaging, files, crypto); await assert.rejects(service.send("conversation",payload,"id"), /SECURE_CORE_UNAVAILABLE/); assert.equal(fetched,false); }
 finally { globalThis.fetch = old; }
});
test("descriptor failure retries exactly the same encrypted media bytes", async () => {
 const old = globalThis.fetch; let seals = 0; let messages = 0; const uploads: string[] = [];
 globalThis.fetch = async (input, init) => { if (String(input).includes("/media/")) { uploads.push(String(init?.body)); return new Response("{}"); } return new Response(JSON.stringify({ id: "id" }), { status: ++messages === 1 ? 503 : 201 }); };
 try { const service = new ConversationService("http://test", async () => "token", "self", { seal: async () => Buffer.from("sealed-message-descriptor-" + ++seals).toString("base64"), open: async () => "" },files,crypto); await assert.rejects(service.send("conversation",payload,"id")); await service.send("conversation",payload,"id"); assert.equal(uploads.length,2); assert.equal(uploads[0],uploads[1]); }
 finally { globalThis.fetch = old; }
});
test("media validation rejects paths, arbitrary MIME types and invalid durations", () => {
 assert.equal(validatePayload(payload).type,"media");
 for (const value of [{...payload,mediaId:"../../x"},{...payload,mimeType:"text/html"},{...payload,durationMs:-1}]) assert.throws(() => validatePayload(value));
});

test("received media never supplies a local file URI", () => { const parsed = parseBody(JSON.stringify(payload)); assert.equal(parsed?.type,"media"); assert.equal((parsed as typeof payload).localUri,undefined); });

test("authenticated media rejects tampering and changes of conversation, sender, id or MIME type", () => {
 const context = { conversationId: "chat", senderUserId: "alice", mediaId: payload.mediaId, mimeType: "audio/mp4" };
 const key = new Uint8Array(32).fill(9), nonce = new Uint8Array(24).fill(8);
 const sealed = encryptMediaBytes("aGVsbG8=", context, key, nonce);
 assert.equal(decryptMediaBytes(sealed.envelope,sealed.key,context),"aGVsbG8=");
 const changed = Buffer.from(sealed.envelope,"base64"); changed[24] = changed[24]! ^ 1;
 assert.throws(() => decryptMediaBytes(changed.toString("base64"),sealed.key,context));
 for (const field of ["conversationId","senderUserId","mediaId","mimeType"] as const) assert.throws(() => decryptMediaBytes(sealed.envelope,sealed.key,{ ...context,[field]:"changed" }));
});


test("captions and ciphertext digests survive opening while local paths are stripped", () => {
 const p = { ...payload, caption: "Private caption", mediaDigest: "a".repeat(64) };
 const received = parseBody(JSON.stringify(p));
 assert.equal(received?.type, "media");
 assert.equal((received as typeof p).caption, p.caption);
 assert.equal((received as typeof p).mediaDigest, p.mediaDigest);
 assert.equal((received as typeof p).localUri, undefined);
 assert.throws(() => validatePayload({ ...p, caption: "x".repeat(MAX_TEXT + 1) }));
 assert.throws(() => validatePayload({ ...p, mediaDigest: "bad" }));
 assert.throws(() => validatePayload({ ...p, mediaKind: "VIDEO", mimeType: "video/mp4", durationMs: 60_001 }));
});

test("sealed media survives service restart and retries without resealing or reading plaintext", async () => {
 let job: any = null; let row: any = null; let reads = 0; let seals = 0;
 const token = "header." + Buffer.from(JSON.stringify({ user_id: "self", device_id: "device" })).toString("base64url") + ".signature";
 const outbox: any = {
  media: { put: async (value: any) => { job = { ...value }; row = { messageId: value.messageId, conversationId: value.conversationId, ciphertext: value.ciphertext }; }, find: async () => job },
  find: async () => row?.ciphertext ?? null, put: async () => {}, pending: async () => row ? [row] : [], remove: async () => { row = null; job = null; },
  failures: { markPermanent: async () => {} }
 };
 const requests: string[] = []; let online = false; const old = globalThis.fetch;
 globalThis.fetch = async (url, init) => { requests.push(String(init?.body)); if (!online) throw new Error("offline"); return new Response(JSON.stringify({ id: "accepted" }), { status: 201 }); };
 try {
  const native = { seal: async () => { seals++; return Buffer.from("sealed-private-caption-and-key").toString("base64"); }, open: async () => "" };
  const first = new ConversationService("http://test", async () => token, "self", native, { ...files, read: async () => { reads++; return "aGVsbG8="; } }, crypto, outbox);
  await assert.rejects(first.send("conversation", { ...payload, caption: "Private caption" }, "stable-id"));
  assert.ok(job); assert.ok(row); assert.equal(job.caption, undefined); assert.equal(job.key, undefined);
  const stored = JSON.stringify(job); assert.ok(!stored.includes("private-recording") && !stored.includes("Private caption"));
  online = true;
  const restarted = new ConversationService("http://test", async () => token, "self", native, { ...files, read: async () => { throw new Error("plaintext is gone"); } }, crypto, outbox);
  assert.deepEqual(await restarted.flushOutbox(), ["stable-id"]);
  assert.equal(reads, 1); assert.equal(seals, 1); assert.equal(job, null); assert.equal(row, null);
  assert.equal(requests[0], requests[1]);
 } finally { globalThis.fetch = old; }
});

test("a saved media job cannot upload under a different device", async () => {
 const token = "header." + Buffer.from(JSON.stringify({ user_id: "self", device_id: "new-device" })).toString("base64url") + ".signature";
 const ciphertext = Buffer.from("sealed-descriptor").toString("base64");
 const job = { messageId: "id", conversationId: "conversation", deviceId: "old-device", mediaId: payload.mediaId, envelope: "c2VhbGVk", ciphertext };
 let fetched = false; const old = globalThis.fetch;
 globalThis.fetch = async () => { fetched = true; return new Response("{}"); };
 const outbox: any = { find: async () => ciphertext, media: { find: async () => job }, failures: { markPermanent: async () => {} } };
 try {
  const service = new ConversationService("http://test", async () => token, "self", unavailableSecureMessaging, files, crypto, outbox);
  await assert.rejects(service.send("conversation", payload, "id"), /DEVICE_SCOPE_REQUIRED/);
  assert.equal(fetched, false);
 } finally { globalThis.fetch = old; }
});

test("discard removes persisted uploads and prevents a later retry", async () => {
 let removed = "";
 const outbox: any = { find: async () => null, remove: async (id: string) => { removed = id; } };
 const service = new ConversationService("http://test", async () => "token", "self", unavailableSecureMessaging, files, crypto, outbox);
 await service.discardPending("discarded-id");
 assert.equal(removed, "discarded-id");
 await assert.rejects((service as any).post("conversation", "discarded-id", "ciphertext"), /MESSAGE_DISCARDED/);
});

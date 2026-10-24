import test from "node:test";
import assert from "node:assert/strict";
import { SecureCoreDevice, SecureCoreError, SecureCoreMessaging, base64ToBytes, bytesToBase64, text, utf8, type CoreBridge, type KeyPackageJson, type PeerDirectory, type SecretStore } from "../clients/mobile/services/secure-core.ts";
import { clearAccountScopedState } from "../clients/mobile/services/account-scope.ts";

// A stand-in for the native core that enforces the same rules the real one does (the real one is tested in
// core/tests/native_bridge_contract.rs): an envelope opens only on the device it names, only with the sender's key, and once.
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));
const NOW_MS = Date.UTC(2026, 9, 6, 12, 0, 0);

class FakeCore implements CoreBridge {
  material: { signing_key: number[]; encryption_secret: number[]; pq_encryption_secret: number[] } | null = null;
  seen = new Set<string>();
  decrypts = 0;
  creates: Array<string | null> = [];
  async createCore(m: string | null) { this.creates.push(m); this.material = m ? unb64(m) : { signing_key: [0], encryption_secret: [0], pq_encryption_secret: Array.from({ length: 64 }, (_, i) => (i * 7 + this.creates.length) % 256) }; return true; }
  async version() { if (!this.material) throw new Error("SECURE_CORE_NOT_CREATED"); return "0.2.0"; }
  async protectionLevel() { return "SOFTWARE_REQUIRES_OS_WRAPPING"; }
  async exportKeyMaterial() { return b64(this.material); }
  async generateKeyPackage(userId: string, deviceId: string, expiresAtMs: number) {
    const m = this.material!;
    const pkg: KeyPackageJson = { version: 2, user_id: userId, device_id: deviceId, signing_public_key: m.signing_key.slice(0, 1).concat(Array(31).fill(m.signing_key[0]!)).slice(0, 32), encryption_public_key: Array(32).fill(m.encryption_secret[0]!), pq_encryption_public_key: [1, 2, 3], created_at_unix: Math.floor(NOW_MS / 1000), expires_at_unix: Math.floor(expiresAtMs / 1000) };
    return b64(pkg);
  }
  async verifyKeyPackage(p: string) { const pkg = unb64(p) as KeyPackageJson; if (pkg.version !== 2 || pkg.expires_at_unix * 1000 <= NOW_MS) throw new Error("bad package"); return true; }
  async encryptMessage(json: string) {
    const r = JSON.parse(json);
    for (const k of ["recipient_encryption_public_key", "recipient_pq_encryption_public_key", "sender_user_id", "sender_device_id", "recipient_user_id", "recipient_device_id", "message_id", "plaintext", "created_at_unix", "expires_at_unix"]) assert.ok(k in r, `request is missing ${k}`);
    assert.ok(Array.isArray(r.plaintext) && r.recipient_encryption_public_key.length === 32);
    return b64({ header: { recipient_device_id: r.recipient_device_id, sender_device_id: r.sender_device_id, message_id: r.message_id }, ciphertext: r.plaintext, sealed_for: r.recipient_encryption_public_key });
  }
  async decryptMessage(reqB64: string) {
    this.decrypts += 1;
    const req = unb64(reqB64);
    for (const k of ["expected_recipient_device_id", "sender_signing_public_key", "envelope", "now_unix"]) assert.ok(k in req, `decrypt request is missing ${k}`);
    const env = req.envelope;
    if (env.header.recipient_device_id !== req.expected_recipient_device_id) throw new Error("wrong device");
    const key = `${req.expected_recipient_device_id}:${env.header.message_id}`;
    if (this.seen.has(key)) throw new Error("replay");
    this.seen.add(key);
    return Buffer.from(env.ciphertext).toString("base64");
  }
}

const mem = (initial: Record<string, string> = {}): SecretStore & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, async protectionLevel() { return "OS_PROTECTED"; }, async get(k) { return data[k] ?? null; }, async put(k, v) { data[k] = v; } };
};
const enrolled = (deviceId: string, seed: number) => mem({ "device.signingPrivateKey": bytesToBase64(new Uint8Array(32).fill(seed)), "device.encryptionPrivateKey": bytesToBase64(new Uint8Array(32).fill(seed + 1)), "device.id": deviceId });

type Phone = { core: FakeCore; device: SecureCoreDevice; store: ReturnType<typeof mem>; userId: string; deviceId: string };
const USER_A = "00000000-0000-4000-8000-0000000000a1";
const USER_B = "00000000-0000-4000-8000-0000000000b2";
const CONV = "00000000-0000-4000-8000-0000000000c0";
function phone(userId: string, deviceId: string, seed: number): Phone {
  const core = new FakeCore(); const store = enrolled(deviceId, seed);
  return { core, store, userId, deviceId, device: new SecureCoreDevice(core, store, userId, () => NOW_MS) };
}
async function directoryOf(phones: Phone[], extra: Record<string, Array<{ deviceId: string; packageBase64: string }>> = {}): Promise<PeerDirectory> {
  const byUser: Record<string, Array<{ deviceId: string; packageBase64: string }>> = {};
  for (const p of phones) (byUser[p.userId] ??= []).push({ deviceId: p.deviceId, packageBase64: (await p.device.createKeyPackage()).packageBase64 });
  for (const [u, list] of Object.entries(extra)) (byUser[u] ??= []).push(...list);
  return { async keyPackages(u) { return byUser[u] ?? []; } };
}
const messaging = (p: Phone, directory: PeerDirectory, members = [USER_A, USER_B]) => new SecureCoreMessaging({ bridge: p.core, device: p.device, directory, members: async () => members, now: () => NOW_MS });
const code = async (promise: Promise<unknown>) => { try { await promise; return "NO_ERROR"; } catch (e) { return e instanceof SecureCoreError ? e.code : `OTHER:${(e as Error).message}`; } };

test("text and base64 helpers round-trip, including emoji, and refuse broken input", () => {
  for (const s of ["", "hello", "héllo 世界", "🙂 ok", "a\u0000b"]) assert.equal(text(utf8(s)), s);
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  assert.equal(bytesToBase64(utf8("hi")), Buffer.from("hi").toString("base64"));
  assert.deepEqual(base64ToBytes(Buffer.from([251, 255, 190]).toString("base64url")), Uint8Array.from([251, 255, 190]));
  assert.throws(() => base64ToBytes("not base64!"), SecureCoreError);
  assert.throws(() => text(Uint8Array.from([0xc3])), SecureCoreError);          // cut short
  assert.throws(() => text(Uint8Array.from([0xff])), SecureCoreError);          // not UTF-8
  assert.throws(() => text(Uint8Array.from([0xed, 0xa0, 0x80])), SecureCoreError); // a surrogate
  assert.throws(() => utf8("\ud800"), SecureCoreError);                          // a lone surrogate
});

test("the device builds its core from the keys it enrolled with plus a post-quantum key it draws once and keeps", async () => {
  const p = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  await p.device.ensure();
  assert.deepEqual(p.core.creates.map((m) => m === null), [true, false]);            // a throwaway draw, then the real core
  const material = p.core.material!;
  assert.deepEqual(material.signing_key, Array(32).fill(1));
  assert.deepEqual(material.encryption_secret, Array(32).fill(2));
  assert.equal(material.pq_encryption_secret.length, 64);
  assert.ok(p.store.data["device.pqSeed"]);
  // A second start reuses the kept key and draws nothing.
  const again = new SecureCoreDevice(p.core, p.store, USER_A, () => NOW_MS);
  const before = p.core.creates.length;
  await again.ensure();
  assert.equal(p.core.creates.length, before + 1);
  assert.deepEqual(p.core.material!.pq_encryption_secret, material.pq_encryption_secret);
});

test("a device that never enrolled has no core, the failure is not remembered, and the probe fails rather than passes", async () => {
  const core = new FakeCore(); const store = mem();
  const device = new SecureCoreDevice(core, store, USER_A, () => NOW_MS);
  assert.equal(await code(device.ensure()), "DEVICE_NOT_ENROLLED");
  await assert.rejects(device.asNativeCore().version());
  assert.equal(core.creates.length, 0);
  Object.assign(store.data, (await enrolled("10000000-0000-4000-8000-0000000000a1", 1)).data);
  await device.ensure();
  assert.equal(await device.asNativeCore().version(), "0.2.0");
  const bad = new SecureCoreDevice(new FakeCore(), mem({ "device.signingPrivateKey": bytesToBase64(new Uint8Array(5)), "device.encryptionPrivateKey": bytesToBase64(new Uint8Array(32)), "device.id": "d" }), USER_A);
  assert.equal(await code(bad.ensure()), "DEVICE_KEYS_INVALID");
});

test("the key package is for this device, valid two weeks, and says when it expires", async () => {
  const p = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const made = await p.device.createKeyPackage();
  assert.equal(made.packageVersion, 2);
  assert.equal(made.expiresAt, new Date(NOW_MS + 14 * 86_400_000).toISOString());
  const pkg = unb64(made.packageBase64) as KeyPackageJson;
  assert.equal(pkg.user_id, USER_A);
  assert.equal(pkg.device_id, "10000000-0000-4000-8000-0000000000a1");
});

test("software core protection requires a verified OS storage adapter", async () => {
  const p = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  delete p.store.protectionLevel;
  assert.equal(await p.device.asNativeCore().protectionLevel(), "SOFTWARE_REQUIRES_OS_WRAPPING");
  p.store.protectionLevel = async () => "OS_PROTECTED";
  assert.equal(await p.device.asNativeCore().protectionLevel(), "OS_PROTECTED");
  p.store.protectionLevel = async () => null;
  assert.equal(await p.device.asNativeCore().protectionLevel(), "SOFTWARE_REQUIRES_OS_WRAPPING");
  p.store.protectionLevel = async () => { throw new Error("keystore unavailable"); };
  await assert.rejects(p.device.asNativeCore().protectionLevel(), /keystore unavailable/);
  p.core.protectionLevel = async () => "unknown";
  assert.equal(await code(p.device.asNativeCore().protectionLevel()), "KEY_PROTECTION_REQUIRED");
});

test("direct message calls cannot bypass key protection, including cached plaintext", async () => {
  const a = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const b = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 2);
  const directory = await directoryOf([a, b]);
  const sender = messaging(a, directory), receiver = messaging(b, directory);
  const context = { conversationId: CONV, senderUserId: USER_A, clientMessageId: "protection-boundary" };
  const ciphertext = await sender.seal("private", context);
  const readContext = { conversationId: CONV, senderUserId: USER_A, messageId: context.clientMessageId };
  assert.equal(await receiver.open(ciphertext, readContext), "private");
  a.store.protectionLevel = async () => null;
  b.store.protectionLevel = async () => null;
  const rejected = (error: unknown) => (error as { code?: string }).code === "MESSAGING_KEY_PROTECTION_REQUIRED";
  await assert.rejects(sender.seal("blocked", { ...context, clientMessageId: "blocked" }), rejected);
  await assert.rejects(receiver.open(ciphertext, readContext), rejected);
});

test("a message is sealed for the other person and for the sender, and opens on both", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const directory = await directoryOf([alice, bob]);
  const a = messaging(alice, directory); const b = messaging(bob, directory);
  const sealed = await a.seal("see you at 10 — café 🙂", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "11111111-1111-4111-8111-111111111111" });
  const bundle = unb64(sealed);
  assert.equal(bundle.v, 1);
  assert.equal(bundle.d, alice.deviceId);
  assert.deepEqual(Object.keys(bundle.e).sort(), [alice.deviceId, bob.deviceId].sort());
  assert.equal(await b.open(sealed, { conversationId: CONV, senderUserId: USER_A, messageId: "srv-1" }), "see you at 10 — café 🙂");
  assert.equal(await a.open(sealed, { conversationId: CONV, senderUserId: USER_A, messageId: "srv-1" }), "see you at 10 — café 🙂");
});

test("every device of every person gets an envelope, and a device that was left out cannot open it", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const alice2 = phone(USER_A, "10000000-0000-4000-8000-0000000000a2", 5);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const bob2 = phone(USER_B, "10000000-0000-4000-8000-0000000000b3", 7);
  const late = phone(USER_B, "10000000-0000-4000-8000-0000000000b9", 9);   // never published a package
  const directory = await directoryOf([alice, alice2, bob, bob2]);
  const sealed = await messaging(alice, directory).seal("hi", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(Object.keys(unb64(sealed).e).length, 4);
  const ctx = { conversationId: CONV, senderUserId: USER_A, messageId: "srv-2" };
  for (const p of [alice2, bob, bob2]) assert.equal(await messaging(p, directory).open(sealed, ctx), "hi");
  assert.equal(await code(messaging(late, directory).open(sealed, ctx)), "NOT_FOR_THIS_DEVICE");
});

test("nothing is sent when the other person has no device to send to, or this device has not published its package", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const ctx = { conversationId: CONV, senderUserId: USER_A, clientMessageId: "33333333-3333-4333-8333-333333333333" };
  assert.equal(await code(messaging(alice, await directoryOf([alice])).seal("x", ctx)), "RECIPIENT_NOT_READY");
  assert.equal(await code(messaging(alice, await directoryOf([bob])).seal("x", ctx)), "OWN_DEVICE_NOT_PUBLISHED");
  assert.equal(await code(messaging(alice, await directoryOf([alice, bob]), [USER_B]).seal("x", ctx)), "NOT_A_MEMBER");
  const crowd = Array.from({ length: 8 }, (_, i) => phone(USER_B, `10000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, 20 + i));
  assert.equal(await code(messaging(alice, await directoryOf([alice, ...crowd])).seal("x", ctx)), "TOO_MANY_DEVICES");
});

test("a message cannot be moved to another conversation or claimed by another sender", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const directory = await directoryOf([alice, bob]);
  const sealed = await messaging(alice, directory).seal("pay me", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "44444444-4444-4444-8444-444444444444" });
  const b = messaging(bob, directory);
  assert.equal(await code(b.open(sealed, { conversationId: "00000000-0000-4000-8000-0000000000c9", senderUserId: USER_A, messageId: "srv-3" })), "MESSAGE_CONTEXT_MISMATCH");
  // Said to be from Bob (who has a device, but not the one the bundle names).
  const b2 = messaging(phone(USER_B, bob.deviceId, 3), directory);
  assert.equal(await code(b2.open(sealed, { conversationId: CONV, senderUserId: USER_B, messageId: "srv-4" })), "SENDER_UNKNOWN");
  assert.equal(await code(messaging(bob, directory).open("e30=", { conversationId: CONV, senderUserId: USER_A, messageId: "srv-5" })), "MESSAGE_FORMAT_INVALID");
  assert.equal(await code(messaging(bob, directory).open(bytesToBase64(utf8("not json")), { conversationId: CONV, senderUserId: USER_A, messageId: "srv-6" })).then((c) => c.startsWith("OTHER") || c === "MESSAGE_FORMAT_INVALID"), true);
});

test("opening the same message again does not reach the core, because the core would refuse it as a replay", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const directory = await directoryOf([alice, bob]);
  const sealed = await messaging(alice, directory).seal("once", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "55555555-5555-4555-8555-555555555555" });
  const b = messaging(bob, directory);
  const ctx = { conversationId: CONV, senderUserId: USER_A, messageId: "srv-7" };
  assert.equal(await b.open(sealed, ctx), "once");
  assert.equal(await b.open(sealed, ctx), "once");
  assert.equal(bob.core.decrypts, 1);
  // A fresh start (a new core) is not the same as a cached one: it opens it for itself.
  const fresh = phone(USER_B, bob.deviceId, 3);
  assert.equal(await messaging(fresh, directory).open(sealed, ctx), "once");
});

test("a key package the core rejects, or that names someone else, is not a device to send to", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const evil = phone(USER_B, "10000000-0000-4000-8000-0000000000e1", 11);
  const stale = b64({ ...unb64((await evil.device.createKeyPackage()).packageBase64), expires_at_unix: 1 });
  const wrongUser = (await phone(USER_A, "10000000-0000-4000-8000-0000000000e2", 12).device.createKeyPackage()).packageBase64;
  const wrongDevice = (await evil.device.createKeyPackage()).packageBase64;
  const directory = await directoryOf([alice, bob], { [USER_B]: [
    { deviceId: "10000000-0000-4000-8000-0000000000e1", packageBase64: stale },            // expired
    { deviceId: "10000000-0000-4000-8000-0000000000e3", packageBase64: wrongUser },        // belongs to another person
    { deviceId: "10000000-0000-4000-8000-0000000000e4", packageBase64: wrongDevice },      // names another device
    { deviceId: "10000000-0000-4000-8000-0000000000e5", packageBase64: "%%%not-a-package" }
  ] });
  const sealed = await messaging(alice, directory).seal("hi", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "66666666-6666-4666-8666-666666666666" });
  assert.deepEqual(Object.keys(unb64(sealed).e).sort(), [alice.deviceId, bob.deviceId].sort());
});

test("a conversation with nobody else in it cannot be sealed, so a message only the sender could read is never made", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const directory = await directoryOf([alice]);
  assert.equal(await code(messaging(alice, directory, [USER_A]).seal("x", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "77777777-7777-4777-8777-777777777777" })), "RECIPIENT_UNKNOWN");
});

test("the person is told, in plain words, why a secure message could not be sent", async () => {
  const { conversationError } = await import("../clients/mobile/services/conversation-engine.ts");
  assert.match(conversationError("RECIPIENT_NOT_READY"), /haven't set up secure messaging/);
  assert.match(conversationError("OWN_DEVICE_NOT_PUBLISHED"), /still setting up/);
});

test("publishing the key package: sent once, then left alone until it is nearly out of date, and the server's refusal is not hidden", async () => {
  const { SecureCoreServer } = await import("../clients/mobile/services/secure-core-server.ts");
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  let status = 201;
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => { calls.push({ url, method: init?.method, body: init?.body as string }); return { ok: status < 400, status, text: async () => JSON.stringify(status < 400 ? { id: "p" } : { error: "invalid_request" }) } as unknown as Response; };
  const p = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  let t = NOW_MS;
  const server = new SecureCoreServer("https://api.test", async () => "tok", () => t);
  assert.equal(await server.publishKeyPackage(p.device, p.store), "PUBLISHED");
  assert.match(calls[0]!.url, /\/v1\/devices\/10000000-0000-4000-8000-0000000000a1\/key-package$/);
  assert.equal(calls[0]!.method, "PUT");
  assert.deepEqual(Object.keys(JSON.parse(calls[0]!.body!)).sort(), ["expiresAt", "packageBase64", "packageVersion"]);
  assert.equal(await server.publishKeyPackage(p.device, p.store), "CURRENT");
  assert.equal(calls.length, 1);
  t += 12 * 86_400_000;                       // two days left: due again
  assert.equal(await server.publishKeyPackage(p.device, p.store), "PUBLISHED");
  status = 400; t += 20 * 86_400_000;
  await assert.rejects(server.publishKeyPackage(p.device, p.store), /invalid_request/);
});

test("other people's key packages are fetched from the server and remembered for a minute", async () => {
  const { SecureCoreServer } = await import("../clients/mobile/services/secure-core-server.ts");
  let hits = 0;
  (globalThis as { fetch: unknown }).fetch = async () => { hits += 1; return { ok: true, status: 200, text: async () => JSON.stringify({ keyPackages: [{ deviceId: "d1", packageBase64: "AAAA", extra: "ignored" }] }) } as unknown as Response; };
  let t = 1_000;
  const server = new SecureCoreServer("https://api.test", async () => "tok", () => t);
  assert.deepEqual(await server.keyPackages(USER_B), [{ deviceId: "d1", packageBase64: "AAAA" }]);
  await server.keyPackages(USER_B);
  assert.equal(hits, 1);
  t += 61_000;
  await server.keyPackages(USER_B);
  assert.equal(hits, 2);
});

// ---- Overlapping opens (the intermittent SECURE_CORE_AUTHENTICATION_FAILED on cold start) ---------------------------------
// The core refuses an envelope it has already opened, and the "already opened" memory is only filled when an open FINISHES. On a
// cold start the thread's receiver is rebuilt shortly after mount (the outbox database finishes opening, which gives the
// conversation service a new identity), so a second pass over the same messages starts while the first is still in flight.
// Without in-flight sharing the second pass reaches the core, which rejects it as a replay and the thread shows
// "Can't open this message (SECURE_CORE_AUTHENTICATION_FAILED)" for every message.

test("opening the same message from several places at once opens it once and gives every caller the text", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const directory = await directoryOf([alice, bob]);
  const sealed = await messaging(alice, directory).seal("hello", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "66666666-6666-4666-8666-666666666666" });
  const b = messaging(bob, directory);
  const ctx = { conversationId: CONV, senderUserId: USER_A, messageId: "srv-9" };
  const results = await Promise.all([b.open(sealed, ctx), b.open(sealed, ctx), b.open(sealed, ctx)]);
  assert.deepEqual(results, ["hello", "hello", "hello"]);
  assert.equal(bob.core.decrypts, 1, "the core is asked once; the rest share that answer");
});

test("a whole thread opened twice at once (receiver rebuilt mid-load) opens every message and reaches the core once each", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const directory = await directoryOf([alice, bob]);
  const a = messaging(alice, directory);
  const thread: Array<{ sealed: string; ctx: { conversationId: string; senderUserId: string; messageId: string }; text: string }> = [];
  for (let i = 0; i < 12; i++) {
    const textBody = `message ${i}`;
    thread.push({ text: textBody, ctx: { conversationId: CONV, senderUserId: USER_A, messageId: `srv-t${i}` },
      sealed: await a.seal(textBody, { conversationId: CONV, senderUserId: USER_A, clientMessageId: `77777777-7777-4777-8777-${String(i).padStart(12, "0")}` }) });
  }
  const b = messaging(bob, directory);
  const pass = () => Promise.all(thread.map((m) => b.open(m.sealed, m.ctx)));
  const [first, second] = await Promise.all([pass(), pass()]); // two overlapping passes over the same thread
  assert.deepEqual(first, thread.map((m) => m.text));
  assert.deepEqual(second, thread.map((m) => m.text));
  assert.equal(bob.core.decrypts, thread.length);
});

test("a genuinely bad envelope still fails (sharing never turns a failure into a success), and a later retry is allowed", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const directory = await directoryOf([alice, bob]);
  const sealed = await messaging(alice, directory).seal("ok", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "88888888-8888-4888-8888-888888888888" });
  const b = messaging(bob, directory);
  const ctx = { conversationId: CONV, senderUserId: USER_A, messageId: "srv-11" };
  // An envelope meant for another device fails for every overlapping caller...
  const wrong = unb64(sealed); wrong.e = { "not-this-device": "x" };
  const bad = b64(wrong);
  const failures = await Promise.all([code(b.open(bad, ctx)), code(b.open(bad, ctx))]);
  assert.deepEqual(failures, ["NOT_FOR_THIS_DEVICE", "NOT_FOR_THIS_DEVICE"]);
  // ...and the failure is not remembered: the real envelope for the same message still opens afterwards.
  assert.equal(await b.open(sealed, ctx), "ok");
});

test("overlapping opens of one message with different content are refused, not silently merged", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const directory = await directoryOf([alice, bob]);
  const a = messaging(alice, directory);
  const one = await a.seal("one", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "99999999-9999-4999-8999-999999999991" });
  const two = await a.seal("two", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "99999999-9999-4999-8999-999999999992" });
  const b = messaging(bob, directory);
  const ctx = { conversationId: CONV, senderUserId: USER_A, messageId: "srv-12" };
  const [x, y] = await Promise.all([code(b.open(one, ctx)), code(b.open(two, ctx))]);
  assert.deepEqual([x, y].sort(), ["MESSAGE_CONTEXT_MISMATCH", "NO_ERROR"].sort());
});

// ---- Account switching while a message is opening ------------------------------------------------------------------------

test("an open that finishes after the account scope changed is dropped for every waiting caller, and nothing is remembered", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const directory = await directoryOf([alice, bob]);
  const sealed = await messaging(alice, directory).seal("private", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  const b = messaging(bob, directory);
  const ctx = { conversationId: CONV, senderUserId: USER_A, messageId: "srv-sw" };

  // Hold the native decrypt open, as a slow device does, so the switch lands while the open is in flight.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const realDecrypt = bob.core.decryptMessage.bind(bob.core);
  bob.core.decryptMessage = async (req: string) => { await gate; return realDecrypt(req); };

  const waiting = [code(b.open(sealed, ctx)), code(b.open(sealed, ctx))]; // two overlapping callers share the one open
  await new Promise((r) => setTimeout(r, 10));
  clearAccountScopedState();                                              // the account is switched away
  release();
  assert.deepEqual(await Promise.all(waiting), ["SECURE_CORE_UNAVAILABLE", "SECURE_CORE_UNAVAILABLE"], "no plaintext reaches either caller");

  // Nothing was remembered either: the old messaging object cannot hand the text out later.
  bob.core.decryptMessage = realDecrypt;
  assert.equal(await code(b.open(sealed, ctx)), "SECURE_CORE_UNAVAILABLE");
});

test("another account's session never serves this account's opened messages", async () => {
  const alice = phone(USER_A, "10000000-0000-4000-8000-0000000000a1", 1);
  const bob = phone(USER_B, "10000000-0000-4000-8000-0000000000b2", 3);
  const directory = await directoryOf([alice, bob]);
  const sealed = await messaging(alice, directory).seal("for bob only", { conversationId: CONV, senderUserId: USER_A, clientMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  const ctx = { conversationId: CONV, senderUserId: USER_A, messageId: "srv-iso" };
  const bobs = messaging(bob, directory);
  assert.equal(await bobs.open(sealed, ctx), "for bob only");

  // A different account's messaging object (its own cache, its own core) is not helped by Bob's cache: it has to open the envelope
  // itself, and an envelope that was not sealed for its device is refused.
  const carol = phone("00000000-0000-4000-8000-0000000000d4", "10000000-0000-4000-8000-0000000000d4", 9);
  const carols = messaging(carol, await directoryOf([alice, bob, carol]));
  assert.equal(await code(carols.open(sealed, ctx)), "NOT_FOR_THIS_DEVICE");
  assert.equal(carol.core.decrypts, 0, "the core is never even asked");
});

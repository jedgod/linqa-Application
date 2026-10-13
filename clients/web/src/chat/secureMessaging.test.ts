// @ts-nocheck -- Node-only artifact loading for the browser-WASM integration test.
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RawWasmCoreBridge } from "../core/RawWasmCoreBridge";
import initializeWasm from "../../public/linqa-core/linqa_core.js";
import { SecureChatError, SecureMessaging, type PeerDirectory } from "./secureMessaging";

const wasmPath = resolve(process.cwd(), "public/linqa-core/linqa_core_bg.wasm");
const wasmBytes = (): ArrayBuffer => { const b = readFileSync(wasmPath); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "99999999-9999-4999-8999-999999999999";
const PHONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LAPTOP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BOB_PHONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Device = { userId: string; deviceId: string; core: RawWasmCoreBridge; messaging?: SecureMessaging };

async function device(userId: string, deviceId: string): Promise<Device> {
  const core = await RawWasmCoreBridge.load({ userId, deviceId, wasmInitializer: initializeWasm, moduleBytes: wasmBytes() });
  return { userId, deviceId, core };
}

/** A fake server directory that serves each published device's key package. */
function directoryOf(devices: Device[], packages: Map<string, string>): PeerDirectory {
  return { keyPackages: async (userId) => devices.filter((d) => d.userId === userId && packages.has(d.deviceId)).map((d) => ({ deviceId: d.deviceId, packageBase64: packages.get(d.deviceId)! })) };
}

async function world(published: string[]) {
  const alicePhone = await device(ALICE, PHONE);
  const aliceLaptop = await device(ALICE, LAPTOP);
  const bobPhone = await device(BOB, BOB_PHONE);
  const all = [alicePhone, aliceLaptop, bobPhone];
  const packages = new Map<string, string>();
  for (const d of all) if (published.includes(d.deviceId)) packages.set(d.deviceId, (await d.core.publishableKeyPackage(d.userId, d.deviceId)).packageBase64);
  const directory = directoryOf(all, packages);
  for (const d of all) {
    d.messaging = new SecureMessaging({ core: d.core, directory, deviceId: () => d.deviceId, members: async () => [ALICE, BOB] });
  }
  return { alicePhone, aliceLaptop, bobPhone, dispose: () => all.forEach((d) => d.core.dispose()) };
}

const send = (from: Device, text: string, id: string) => from.messaging.seal(text, { conversationId: CONVERSATION, senderUserId: from.userId, clientMessageId: id });
const open = (as: Device, bundle: string, sender: string, id: string) => as.messaging.open(bundle, { conversationId: CONVERSATION, senderUserId: sender, messageId: id });
const code = async (promise: Promise<unknown>) => { try { await promise; return null; } catch (e) { return e instanceof SecureChatError ? e.code : String(e); } };

describe("web secure messaging, with two people and a linked computer", () => {
  it("a message sent from the phone opens on the phone, on the linked computer, and for the other person", async () => {
    const w = await world([PHONE, LAPTOP, BOB_PHONE]);
    try {
      const bundle = await send(w.alicePhone, "hello from the phone", "m1");
      expect(await open(w.alicePhone, bundle, ALICE, "m1")).toBe("hello from the phone");
      expect(await open(w.aliceLaptop, bundle, ALICE, "m1")).toBe("hello from the phone");
      expect(await open(w.bobPhone, bundle, ALICE, "m1")).toBe("hello from the phone");
    } finally { w.dispose(); }
  });

  it("a message sent from the linked computer opens on the phone too", async () => {
    const w = await world([PHONE, LAPTOP, BOB_PHONE]);
    try {
      const bundle = await send(w.aliceLaptop, "hello from the laptop, with emoji 😀 and accents é", "m2");
      expect(await open(w.alicePhone, bundle, ALICE, "m2")).toBe("hello from the laptop, with emoji 😀 and accents é");
      expect(await open(w.bobPhone, bundle, ALICE, "m2")).toBe("hello from the laptop, with emoji 😀 and accents é");
    } finally { w.dispose(); }
  });

  it("a device that had not published a key package when the message was sent cannot open it", async () => {
    const w = await world([PHONE, BOB_PHONE]);
    try {
      const bundle = await send(w.alicePhone, "before the laptop was linked", "m3");
      expect(await code(open(w.aliceLaptop, bundle, ALICE, "m3"))).toBe("NOT_FOR_THIS_DEVICE");
    } finally { w.dispose(); }
  });

  it("refuses to send when the other person has no device to send to, or when this device is not published", async () => {
    const noBob = await world([PHONE, LAPTOP]);
    try { expect(await code(send(noBob.alicePhone, "x", "m4"))).toBe("RECIPIENT_NOT_READY"); } finally { noBob.dispose(); }
    const notMe = await world([BOB_PHONE, PHONE]);
    try { expect(await code(send(notMe.aliceLaptop, "x", "m5"))).toBe("OWN_DEVICE_NOT_PUBLISHED"); } finally { notMe.dispose(); }
  });

  it("refuses a message claimed by the wrong sender, moved to another conversation, or tampered with", async () => {
    const w = await world([PHONE, LAPTOP, BOB_PHONE]);
    try {
      const bundle = await send(w.alicePhone, "secret", "m6");
      expect(await code(open(w.bobPhone, bundle, BOB, "m6"))).toBe("SENDER_UNKNOWN");
      const moved = await code(w.bobPhone.messaging.open(bundle, { conversationId: "88888888-8888-4888-8888-888888888888", senderUserId: ALICE, messageId: "m6b" }));
      expect(moved).not.toBeNull();
      const parts = JSON.parse(atob(bundle));
      parts.e[BOB_PHONE] = btoa(JSON.stringify({ tampered: true }));
      expect(await code(open(w.bobPhone, btoa(JSON.stringify(parts)), ALICE, "m6c"))).not.toBeNull();
    } finally { w.dispose(); }
  });

  it("an opened message is remembered, so opening it again is not a replay failure", async () => {
    const w = await world([PHONE, LAPTOP, BOB_PHONE]);
    try {
      const bundle = await send(w.alicePhone, "once", "m7");
      expect(await open(w.bobPhone, bundle, ALICE, "m7")).toBe("once");
      expect(await open(w.bobPhone, bundle, ALICE, "m7")).toBe("once");
      expect(await code(open(w.bobPhone,bundle,BOB,"m7"))).toBe("MESSAGE_CONTEXT_MISMATCH");
      expect(await code(open(w.bobPhone,bundle+"A",ALICE,"m7"))).toBe("MESSAGE_CONTEXT_MISMATCH");
    } finally { w.dispose(); }
  });

  it("a key package that the core rejects is not a device to send to", async () => {
    const w = await world([PHONE, BOB_PHONE]);
    try {
      const real = await w.alicePhone.core.publishableKeyPackage(ALICE, PHONE);
      const forgedBob = btoa(JSON.stringify({ version: 1, user_id: BOB, device_id: BOB_PHONE, signing_public_key: new Array(32).fill(1), encryption_public_key: new Array(32).fill(2), pq_encryption_public_key: [1], created_at_unix: 1, expires_at_unix: 2, signature: new Array(64).fill(0) }));
      const dir = { keyPackages: async (u) => [u === BOB ? { deviceId: BOB_PHONE, packageBase64: forgedBob } : { deviceId: PHONE, packageBase64: real.packageBase64 }] };
      const messaging = new SecureMessaging({ core: w.alicePhone.core, directory: dir, deviceId: () => PHONE, members: async () => [ALICE, BOB] });
      expect(await code(messaging.seal("x", { conversationId: CONVERSATION, senderUserId: ALICE, clientMessageId: "m8" }))).toBe("RECIPIENT_NOT_READY");
    } finally { w.dispose(); }
  });
});

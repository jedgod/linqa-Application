// @ts-nocheck -- Node-only artifact loading for the browser-WASM integration test.
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RawWasmCoreBridge } from "./RawWasmCoreBridge";
import initializeWasm from "../../public/linqa-core/linqa_core.js";

const wasmPath = resolve(process.cwd(), "public/linqa-core/linqa_core_bg.wasm");

function wasmBytes(): ArrayBuffer {
  const bytes = readFileSync(wasmPath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("Rust/WASM secure client path", () => {
  it("encrypts for Bob and authenticates/decrypts as Bob", async () => {
    const alice = await RawWasmCoreBridge.load({
      userId: "11111111-1111-4111-8111-111111111111",
      deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      wasmInitializer: initializeWasm,
      moduleBytes: wasmBytes()
    });
    const bob = await RawWasmCoreBridge.load({
      userId: "22222222-2222-4222-8222-222222222222",
      deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      wasmInitializer: initializeWasm,
      moduleBytes: wasmBytes()
    });

    try {
      expect((await alice.runtimeInfo()).secureCoreReady).toBe(true);
      const bobPackage = await bob.createKeyPackage();
      const now = Math.floor(Date.now() / 1000);
      const envelope = await alice.encryptMessage({
        messageId: "33333333-3333-4333-8333-333333333333",
        senderUserId: "11111111-1111-4111-8111-111111111111",
        senderDeviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        recipientUserId: "22222222-2222-4222-8222-222222222222",
        recipientDeviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        recipientKeyPackageBase64: base64(bobPackage),
        plaintext: "real Rust core to relay payload to Bob",
        createdAtUnix: now,
        expiresAtUnix: now + 3600
      });
      const aliceIdentity = await alice.publicIdentity();
      const opened = await bob.decryptMessage(envelope, aliceIdentity.signingPublicKeyBase64);

      expect(opened.messageId).toBe("33333333-3333-4333-8333-333333333333");
      expect(opened.plaintext).toBe("real Rust core to relay payload to Bob");
    } finally {
      alice.dispose();
      bob.dispose();
    }
  });
});

import type { SecureCoreBridge } from "./SecureCoreBridge";
import { WebCryptoKeyProvider } from "../security/WebCryptoKeyProvider";

type WasmExports = {
  memory: WebAssembly.Memory;
  linqa_alloc(length: number): number;
  linqa_dealloc(pointer: number, length: number): void;
  linqa_core_new(pointer: number, length: number): bigint;
  linqa_core_drop(handle: number): void;
  linqa_core_runtime(handle: number): bigint;
  linqa_core_public_identity(handle: number): bigint;
  linqa_core_export_keys(handle: number): bigint;
  linqa_core_enrollment_proof(handle: number, pointer: number, length: number): bigint;
  linqa_core_key_package(handle: number, pointer: number, length: number): bigint;
  linqa_core_encrypt(handle: number, pointer: number, length: number): bigint;
  linqa_core_decrypt(handle: number, pointer: number, length: number): bigint;
};

type WasmResponse<T> = { ok: boolean; value: T | null; error: string | null };
type RustKeyPackage = {
  version: number;
  user_id: string;
  device_id: string;
  signing_public_key: number[];
  encryption_public_key: number[];
  pq_encryption_public_key: number[];
  created_at_unix: number;
  expires_at_unix: number;
  signature: number[];
};

const KEY_CONTEXT = new TextEncoder().encode("linqa:rust-core-key-material:v1");

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

class BrowserCoreKeyStore {
  private readonly keyAlias: string;
  private readonly storageKey: string;

  constructor(userId: string, deviceId: string, private readonly keys = new WebCryptoKeyProvider()) {
    const namespace = `${userId}:${deviceId}`;
    this.keyAlias = `linqa-rust-core-keys:${namespace}`;
    this.storageKey = `linqa.rust-core.key-material.v1:${namespace}`;
  }

  async load(): Promise<Uint8Array | null> {
    const encoded = localStorage.getItem(this.storageKey);
    if (!encoded) return null;
    return this.keys.unwrapKey({
      alias: this.keyAlias,
      wrappedKey: base64ToBytes(encoded),
      context: KEY_CONTEXT
    });
  }

  async save(material: Uint8Array): Promise<void> {
    await this.keys.createWrappingKey(this.keyAlias);
    const wrapped = await this.keys.wrapKey({ alias: this.keyAlias, rawKey: material, context: KEY_CONTEXT });
    localStorage.setItem(this.storageKey, bytesToBase64(wrapped));
  }
}

export class RawWasmCoreBridge implements SecureCoreBridge {
  private constructor(
    private readonly wasm: WasmExports,
    private readonly handle: number,
    private readonly identity: { userId: string; deviceId: string }
  ) {}

  static async load(input: {
    userId: string;
    deviceId: string;
    keyStorageNamespace?: string;
    wasmUrl?: string;
    glueUrl?: string;
    moduleBytes?: ArrayBuffer;
    wasmInitializer?: (input: { module_or_path: ArrayBuffer | string | URL }) => Promise<WasmExports>;
  }): Promise<RawWasmCoreBridge> {
    const initializer = input.wasmInitializer ?? (await import(
      /* @vite-ignore */ input.glueUrl ?? "/linqa-core/linqa_core.js"
    ) as { default(input: { module_or_path: ArrayBuffer | string | URL }): Promise<WasmExports> }).default;
    const wasm = await initializer({
      module_or_path: input.moduleBytes ?? input.wasmUrl ?? "/linqa-core/linqa_core_bg.wasm"
    });
    const keyStore = new BrowserCoreKeyStore(input.userId, input.keyStorageNamespace ?? input.deviceId);
    const persisted = await keyStore.load();
    const created = callJson<number>(wasm, (pointer, length) => wasm.linqa_core_new(pointer, length), persisted ?? undefined);
    const bridge = new RawWasmCoreBridge(wasm, created, { userId: input.userId, deviceId: input.deviceId });
    if (!persisted) {
      const material = callJson<unknown>(wasm, () => wasm.linqa_core_export_keys(created));
      await keyStore.save(new TextEncoder().encode(JSON.stringify(material)));
    }
    return bridge;
  }

  dispose(): void {
    this.wasm.linqa_core_drop(this.handle);
  }

  setEnrolledDeviceId(deviceId: string): void {
    if (!deviceId.trim()) throw new Error("enrolled device ID is required");
    this.identity.deviceId = deviceId;
  }

  async runtimeInfo() {
    const info = callJson<{ api_version: number; protocol_version: number; build_version: string; secure_core_ready: boolean }>(
      this.wasm,
      () => this.wasm.linqa_core_runtime(this.handle)
    );
    return {
      secureCoreReady: info.secure_core_ready,
      apiVersion: info.api_version,
      protocolVersion: info.protocol_version,
      buildVersion: info.build_version
    };
  }

  async publicIdentity(): Promise<{
    signingPublicKeyBase64: string;
    encryptionPublicKeyBase64: string;
    pqEncryptionPublicKeyBase64: string;
  }> {
    const identity = callJson<{
      signingPublicKey: number[];
      encryptionPublicKey: number[];
      pqEncryptionPublicKey: number[];
    }>(this.wasm, () => this.wasm.linqa_core_public_identity(this.handle));
    return {
      signingPublicKeyBase64: bytesToBase64(Uint8Array.from(identity.signingPublicKey)),
      encryptionPublicKeyBase64: bytesToBase64(Uint8Array.from(identity.encryptionPublicKey)),
      pqEncryptionPublicKeyBase64: bytesToBase64(Uint8Array.from(identity.pqEncryptionPublicKey))
    };
  }

  async createEnrollmentProof(input: {
    userId: string;
    deviceId: string;
    challengeBase64: string;
    deviceName?: string;
    platform?: "WEB" | "DESKTOP";
  }): Promise<Uint8Array> {
    const wire = JSON.parse(new TextDecoder().decode(base64ToBytes(input.challengeBase64))) as {
      challengeId: string;
      userId: string;
      nonceBase64: string;
      expiresAt: string;
    };
    if (wire.userId !== input.userId) throw new Error("enrollment challenge user mismatch");
    const request = new TextEncoder().encode(JSON.stringify({
      challenge: {
        challenge_id: wire.challengeId,
        user_id: wire.userId,
        nonce: Array.from(base64ToBytes(wire.nonceBase64)),
        expires_at_unix: Math.floor(new Date(wire.expiresAt).getTime() / 1000)
      },
      device_name: input.deviceName ?? "Linqa Web",
      platform: input.platform ?? "WEB"
    }));
    const proof = callJson<unknown>(
      this.wasm,
      (pointer, length) => this.wasm.linqa_core_enrollment_proof(this.handle, pointer, length),
      request
    );
    return new TextEncoder().encode(JSON.stringify(proof));
  }

  async createKeyPackage(): Promise<Uint8Array> {
    const now = Math.floor(Date.now() / 1000);
    const request = new TextEncoder().encode(JSON.stringify({
      user_id: this.identity.userId,
      device_id: this.identity.deviceId,
      created_at_unix: now,
      expires_at_unix: now + 7 * 24 * 60 * 60
    }));
    const keyPackage = callJson<RustKeyPackage>(
      this.wasm,
      (pointer, length) => this.wasm.linqa_core_key_package(this.handle, pointer, length),
      request
    );
    return new TextEncoder().encode(JSON.stringify(keyPackage));
  }

  async encryptMessage(input: {
    messageId: string; senderUserId: string; senderDeviceId: string;
    recipientUserId: string; recipientDeviceId: string; recipientKeyPackageBase64: string;
    plaintext: string; createdAtUnix: number; expiresAtUnix: number;
  }): Promise<Uint8Array> {
    const keyPackage = JSON.parse(new TextDecoder().decode(base64ToBytes(input.recipientKeyPackageBase64))) as RustKeyPackage;
    if (keyPackage.user_id !== input.recipientUserId || keyPackage.device_id !== input.recipientDeviceId) {
      throw new Error("recipient key package identity mismatch");
    }
    if (keyPackage.expires_at_unix <= Math.floor(Date.now() / 1000)) throw new Error("recipient key package expired");
    const request = new TextEncoder().encode(JSON.stringify({
      recipient_encryption_public_key: keyPackage.encryption_public_key,
      recipient_pq_encryption_public_key: keyPackage.pq_encryption_public_key,
      sender_user_id: input.senderUserId,
      sender_device_id: input.senderDeviceId,
      recipient_user_id: input.recipientUserId,
      recipient_device_id: input.recipientDeviceId,
      message_id: input.messageId,
      plaintext: Array.from(new TextEncoder().encode(input.plaintext)),
      created_at_unix: input.createdAtUnix,
      expires_at_unix: input.expiresAtUnix
    }));
    const envelope = callJson<unknown>(
      this.wasm,
      (pointer, length) => this.wasm.linqa_core_encrypt(this.handle, pointer, length),
      request
    );
    return new TextEncoder().encode(JSON.stringify(envelope));
  }

  async decryptMessage(ciphertext: Uint8Array, senderSigningPublicKeyBase64?: string) {
    if (!senderSigningPublicKeyBase64) throw new Error("sender signing key is required");
    const envelope = JSON.parse(new TextDecoder().decode(ciphertext)) as {
      header: { message_id: string; sender_user_id: string; sender_device_id: string };
    };
    const request = new TextEncoder().encode(JSON.stringify({
      expected_recipient_device_id: this.identity.deviceId,
      sender_signing_public_key: Array.from(base64ToBytes(senderSigningPublicKeyBase64)),
      envelope,
      now_unix: Math.floor(Date.now() / 1000)
    }));
    const plaintext = callJson<number[]>(
      this.wasm,
      (pointer, length) => this.wasm.linqa_core_decrypt(this.handle, pointer, length),
      request
    );
    return {
      messageId: envelope.header.message_id,
      senderUserId: envelope.header.sender_user_id,
      senderDeviceId: envelope.header.sender_device_id,
      plaintext: new TextDecoder().decode(Uint8Array.from(plaintext))
    };
  }
}

function callJson<T>(
  wasm: WasmExports,
  operation: (pointer: number, length: number) => bigint,
  input?: Uint8Array
): T {
  let inputPointer = 0;
  try {
    if (input?.length) {
      inputPointer = wasm.linqa_alloc(input.length);
      new Uint8Array(wasm.memory.buffer, inputPointer, input.length).set(input);
    }
    const packed = operation(inputPointer, input?.length ?? 0);
    const outputPointer = Number(packed >> 32n);
    const outputLength = Number(packed & 0xffff_ffffn);
    const output = new Uint8Array(wasm.memory.buffer, outputPointer, outputLength).slice();
    wasm.linqa_dealloc(outputPointer, outputLength);
    const response = JSON.parse(new TextDecoder().decode(output)) as WasmResponse<T>;
    if (!response.ok || response.value === null) throw new Error(response.error ?? "secure core operation failed");
    return response.value;
  } finally {
    if (inputPointer && input?.length) wasm.linqa_dealloc(inputPointer, input.length);
  }
}

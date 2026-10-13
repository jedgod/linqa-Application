import type { SecureMessaging } from "./conversation.service";
import { accountScopeGeneration } from "./account-scope";

/**
 * Glue between the app and the Rust secure core: the device's key material, its published key package, and message
 * sealing for the people in a conversation. The cryptography is entirely in the core; nothing here invents any. Every
 * problem (a missing key, a bad package, a message meant for another device) ends in an error and never in plain text.
 */

export interface CoreBridge {
  createCore(keyMaterialB64: string | null): Promise<boolean>;
  version(): Promise<string>;
  protectionLevel(): Promise<string>;
  exportKeyMaterial(): Promise<string>;
  generateKeyPackage(userId: string, deviceId: string, expiresAtMs: number): Promise<string>;
  verifyKeyPackage(packageB64: string): Promise<boolean>;
  encryptMessage(requestJson: string): Promise<string>;
  decryptMessage(envelopeB64: string): Promise<string>;
}

export class SecureCoreError extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new SecureCoreError(code); };

// ---- bytes <-> base64, and text <-> bytes (no Buffer in the app) --------------------------------------------------

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : "=") + (i + 2 < bytes.length ? ALPHABET[n & 63]! : "=");
  }
  return out;
}
export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) throw new SecureCoreError("INVALID_BASE64");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (ALPHABET.indexOf(clean[i]!) << 18) | (ALPHABET.indexOf(clean[i + 1]!) << 12) | ((i + 2 < clean.length ? ALPHABET.indexOf(clean[i + 2]!) : 0) << 6) | (i + 3 < clean.length ? ALPHABET.indexOf(clean[i + 3]!) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out;
}
/** UTF-8 by hand: the phone's JavaScript engine does not reliably have TextEncoder / TextDecoder. */
export function utf8(value: string): Uint8Array {
  const out: number[] = [];
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (c >= 0xd800 && c <= 0xdfff) throw new SecureCoreError("INVALID_TEXT"); // a lone surrogate
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}
export function text(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    const extra = b < 0x80 ? 0 : b >= 0xc2 && b < 0xe0 ? 1 : b >= 0xe0 && b < 0xf0 ? 2 : b >= 0xf0 && b < 0xf5 ? 3 : -1;
    if (extra < 0) throw new SecureCoreError("INVALID_TEXT");
    let c = extra === 0 ? b : b & (0x3f >> extra);
    for (let k = 1; k <= extra; k++) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) throw new SecureCoreError("INVALID_TEXT");
      c = (c << 6) | (next & 63);
    }
    if ((extra === 2 && c < 0x800) || (extra === 3 && c < 0x10000) || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) throw new SecureCoreError("INVALID_TEXT");
    out += String.fromCodePoint(c);
    i += extra + 1;
  }
  return out;
}
const jsonB64 = (value: unknown) => bytesToBase64(utf8(JSON.stringify(value)));
const fromJsonB64 = <T>(b64: string): T => JSON.parse(text(base64ToBytes(b64))) as T;
const nums = (bytes: Uint8Array) => Array.from(bytes);

// ---- the device's own key material ----------------------------------------------------------------------------------

export interface SecretStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

type KeyMaterial = { signing_key: number[]; encryption_secret: number[]; pq_encryption_secret: number[] };

/**
 * Builds the core from the keys this device enrolled with (so the server's record of the device still matches) plus a
 * post-quantum key that this device draws once and keeps. The keys come from, and go back to, the account's secure storage.
 */
export class SecureCoreDevice {
  private readonly scopeGeneration=accountScopeGeneration();
  private assertScope(){if(this.scopeGeneration!==accountScopeGeneration())throw new SecureCoreError('SECURE_CORE_UNAVAILABLE');}
  private ready: Promise<void> | null = null;
  constructor(private readonly bridge: CoreBridge, private readonly store: SecretStore, readonly userId: string, private readonly now: () => number = Date.now) {}

  /** Creates the core once; later calls wait for the same result. A failure is not remembered, so it can be retried. */
  ensure(): Promise<void> {
    this.assertScope();
    this.ready ??= this.init().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  private async init(): Promise<void> {
    const [signing, encryption, deviceId] = await Promise.all([this.store.get("device.signingPrivateKey"), this.store.get("device.encryptionPrivateKey"), this.store.get("device.id")]);
    this.assertScope();
    if (!signing || !encryption || !deviceId) return fail("DEVICE_NOT_ENROLLED");
    const signingKey = base64ToBytes(signing);
    const encryptionSecret = base64ToBytes(encryption);
    if (signingKey.length !== 32 || encryptionSecret.length !== 32) return fail("DEVICE_KEYS_INVALID");

    let pq = await this.store.get("device.pqSeed");
    this.assertScope();
    if (!pq) {
      // Draw a fresh post-quantum key from a throwaway core, keep only that part, and remember it.
      await this.bridge.createCore(null);
      this.assertScope();
      const drawn = fromJsonB64<KeyMaterial>(await this.bridge.exportKeyMaterial());
      this.assertScope();
      pq = bytesToBase64(Uint8Array.from(drawn.pq_encryption_secret));
      await this.store.put("device.pqSeed", pq);
    }
    const material: KeyMaterial = { signing_key: nums(signingKey), encryption_secret: nums(encryptionSecret), pq_encryption_secret: nums(base64ToBytes(pq)) };
    this.assertScope();
    await this.bridge.createCore(jsonB64(material));
    this.assertScope();
  }

  async deviceId(): Promise<string> { this.assertScope();const id=await this.store.get("device.id");this.assertScope();return id??fail("DEVICE_NOT_ENROLLED"); }

  /** What the messaging gate probes: it reports present only once the core really answers. */
  asNativeCore() {
    return {
      version: async () => { await this.ensure(); return this.bridge.version(); },
      protectionLevel: async () => { await this.ensure(); return this.bridge.protectionLevel() as Promise<"SOFTWARE_REQUIRES_OS_WRAPPING" | "OS_PROTECTED" | "HARDWARE_BACKED">; }
    };
  }

  /** A signed key package for this device, valid two weeks, in the form the server publishes. */
  async createKeyPackage(): Promise<{ packageBase64: string; packageVersion: number; expiresAt: string }> {
    await this.ensure();
    const expiresAtMs = this.now() + 14 * 86_400_000;
    const packageBase64 = await this.bridge.generateKeyPackage(this.userId, await this.deviceId(), expiresAtMs);
    const parsed = fromJsonB64<{ version: number; expires_at_unix: number }>(packageBase64);
    return { packageBase64, packageVersion: parsed.version, expiresAt: new Date(parsed.expires_at_unix * 1000).toISOString() };
  }
}

// ---- other people's devices -------------------------------------------------------------------------------------------

export type KeyPackageJson = {
  version: number; user_id: string; device_id: string;
  signing_public_key: number[]; encryption_public_key: number[]; pq_encryption_public_key: number[];
  created_at_unix: number; expires_at_unix: number;
};
export type PeerDevice = { userId: string; deviceId: string; pkg: KeyPackageJson };

/** Where the key packages of a person's devices come from (the server, in the app). */
export interface PeerDirectory {
  keyPackages(userId: string, fresh?: boolean): Promise<Array<{ deviceId: string; packageBase64: string }>>;
  historicalSenderKey?(context: {conversationId:string;messageId:string;senderUserId:string;senderDeviceId:string;ciphertextBase64:string}): Promise<number[]>;
}

const MAX_DEVICES = 8;
/** Envelopes outlive any plausible history: ten years. */
const ENVELOPE_LIFETIME_S = 10 * 365 * 86_400;
const CACHE_LIMIT = 20_000;

type Bundle = { v: 1; d: string; e: Record<string, string> };
type Inner = { v: 1; c: string; s: string; t: string };

/**
 * Seals a message for every device of every person in the conversation (including this person's own devices, so they can
 * read their own history), and opens messages meant for this device. The result is one opaque bundle the server stores
 * as the message body. The conversation and the sender are sealed inside, so a message moved to another conversation, or
 * claimed by another sender, is refused.
 */
export class SecureCoreMessaging implements SecureMessaging {
  /** Opening the same envelope twice is refused by the core as a replay, so what was opened stays here (memory only). */
  private readonly opened = new Map<string,{plaintext:string;ciphertext:string;senderUserId:string}>();

  constructor(private readonly deps: {
    bridge: CoreBridge; device: SecureCoreDevice; directory: PeerDirectory;
    /** The people in a conversation, this person included. */
    members: (conversationId: string) => Promise<string[]>;
    now?: () => number;
  }) {}

  private now() { return Math.floor((this.deps.now?.() ?? Date.now()) / 1000); }

  /** Every device of `userId` whose package the core accepts and that names who it says it is; the rest are ignored. */
  private async devicesOf(userId: string, fresh=false): Promise<PeerDevice[]> {
    const out: PeerDevice[] = [];
    for (const entry of await this.deps.directory.keyPackages(userId, fresh)) {
      try {
        if(!await this.deps.bridge.verifyKeyPackage(entry.packageBase64))continue;
        const pkg = fromJsonB64<KeyPackageJson>(entry.packageBase64);
        if (pkg.user_id !== userId || pkg.device_id !== entry.deviceId || pkg.signing_public_key.length !== 32 || pkg.encryption_public_key.length !== 32 || pkg.pq_encryption_public_key.length === 0) continue;
        out.push({ userId, deviceId: entry.deviceId, pkg });
      } catch { /* a package the core will not accept is not a device to send to */ }
    }
    return out;
  }

  async seal(plaintext: string, context: { conversationId: string; senderUserId: string; clientMessageId: string }): Promise<string> {
    await this.deps.device.ensure();
    const selfDevice = await this.deps.device.deviceId();
    const people = Array.from(new Set(await this.deps.members(context.conversationId)));
    if (!people.includes(context.senderUserId)) return fail("NOT_A_MEMBER");
    // A message only the sender could read is not a message: a conversation needs someone else in it.
    if (people.length < 2) return fail("RECIPIENT_UNKNOWN");
    const recipients: PeerDevice[] = [];
    for (const userId of people) {
      const devices = await this.devicesOf(userId, true);
      // Someone who has no device to send to cannot be sent to: do not send a message only the sender can read.
      if (devices.length === 0) return fail(userId === context.senderUserId ? "OWN_DEVICE_NOT_PUBLISHED" : "RECIPIENT_NOT_READY");
      recipients.push(...devices);
    }
    if (!recipients.some((r) => r.userId === context.senderUserId && r.deviceId === selfDevice)) return fail("OWN_DEVICE_NOT_PUBLISHED");
    if (recipients.length > MAX_DEVICES) return fail("TOO_MANY_DEVICES");

    const inner: Inner = { v: 1, c: context.conversationId, s: context.senderUserId, t: plaintext };
    const created = this.now();
    const e: Record<string, string> = {};
    for (const r of recipients) {
      await this.deps.device.ensure();
      e[r.deviceId] = await this.deps.bridge.encryptMessage(JSON.stringify({
        recipient_encryption_public_key: r.pkg.encryption_public_key,
        recipient_pq_encryption_public_key: r.pkg.pq_encryption_public_key,
        sender_user_id: context.senderUserId, sender_device_id: selfDevice,
        recipient_user_id: r.userId, recipient_device_id: r.deviceId,
        message_id: context.clientMessageId, plaintext: nums(utf8(JSON.stringify(inner))),
        created_at_unix: created, expires_at_unix: created + ENVELOPE_LIFETIME_S
      }));
      await this.deps.device.ensure();
    }
    const bundle: Bundle = { v: 1, d: selfDevice, e };
    return jsonB64(bundle);
  }

  async open(ciphertextBase64: string, context: { conversationId: string; senderUserId: string; messageId: string }): Promise<string> {
    await this.deps.device.ensure();
    const key = `${context.conversationId}:${context.messageId}`;
    const known = this.opened.get(key);
    if(known!==undefined){
      if(known.ciphertext!==ciphertextBase64||known.senderUserId!==context.senderUserId)return fail("MESSAGE_CONTEXT_MISMATCH");
      return known.plaintext;
    }

    await this.deps.device.ensure();
    const selfDevice = await this.deps.device.deviceId();
    const bundle = fromJsonB64<Bundle>(ciphertextBase64);
    if (bundle?.v !== 1 || typeof bundle.d !== "string" || typeof bundle.e !== "object" || bundle.e === null) return fail("MESSAGE_FORMAT_INVALID");
    const mine = bundle.e[selfDevice];
    if (typeof mine !== "string") return fail("NOT_FOR_THIS_DEVICE");

    // Who sent it: the device the bundle names must be a device of the sender the server says sent it.
    const sender = (await this.devicesOf(context.senderUserId)).find((d) => d.deviceId === bundle.d);
    const signingKey = sender?.pkg.signing_public_key ?? await this.deps.directory.historicalSenderKey?.({...context,senderDeviceId:bundle.d,ciphertextBase64});
    if (!signingKey || signingKey.length!==32 || !signingKey.every(n=>Number.isInteger(n)&&n>=0&&n<=255)) return fail("SENDER_UNKNOWN");
    const envelope = fromJsonB64<unknown>(mine);
    await this.deps.device.ensure();
    const plain = await this.deps.bridge.decryptMessage(jsonB64({
      expected_recipient_device_id: selfDevice, sender_signing_public_key: signingKey, envelope, now_unix: this.now()
    }));
    await this.deps.device.ensure();
    const inner = JSON.parse(text(base64ToBytes(plain))) as Inner;
    if (inner?.v !== 1 || inner.c !== context.conversationId || inner.s !== context.senderUserId || typeof inner.t !== "string") return fail("MESSAGE_CONTEXT_MISMATCH");
    if (this.opened.size >= CACHE_LIMIT) this.opened.delete(this.opened.keys().next().value as string);
    this.opened.set(key,{plaintext:inner.t,ciphertext:ciphertextBase64,senderUserId:context.senderUserId});
    return inner.t;
  }
}

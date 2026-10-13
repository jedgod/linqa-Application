/**
 * Seals and opens messages for the browser. This follows the phone's `SecureCoreMessaging` (clients/mobile/services/secure-core.ts)
 * exactly on the wire, so a message sent from either one opens on the other:
 *
 *   bundle  = base64(JSON { v: 1, d: <sender device id>, e: { <device id>: base64(JSON envelope), ... } })
 *   inner   = JSON { v: 1, c: <conversation id>, s: <sender user id>, t: <text> }   (this is what each envelope seals)
 *
 * A message is sealed once for every device of every person in the conversation, this person's own devices included, so a
 * linked computer can read what the phone sends and the phone can read what the computer sends. The cryptography is entirely in
 * the Rust core (WebAssembly). Every problem (a missing key, a bad package, a message meant for another device) ends in an error,
 * never in plain text.
 */

export class SecureChatError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SecureChatError";
  }
}
const fail = (code: string): never => { throw new SecureChatError(code); };

/** What the chat layer needs from the core. `RawWasmCoreBridge` provides all of it. */
export interface ChatCore {
  verifyKeyPackage(keyPackage: unknown): Promise<void>;
  encryptRaw(request: unknown): Promise<unknown>;
  decryptRaw(request: unknown): Promise<Uint8Array>;
}

export interface KeyPackageJson {
  version: number; user_id: string; device_id: string;
  signing_public_key: number[]; encryption_public_key: number[]; pq_encryption_public_key: number[];
  created_at_unix: number; expires_at_unix: number;
}
export interface PeerDevice { userId: string; deviceId: string; pkg: KeyPackageJson }

export interface PeerDirectory {
  keyPackages(userId: string, fresh?: boolean): Promise<Array<{ deviceId: string; packageBase64: string }>>;
  historicalSenderKey?(context: {conversationId:string;messageId:string;senderUserId:string;senderDeviceId:string;ciphertextBase64:string}): Promise<number[]>;
}

const MAX_DEVICES = 8;
/** Envelopes outlive any plausible history: ten years (the same as the phone). */
const ENVELOPE_LIFETIME_S = 10 * 365 * 86_400;
const CACHE_LIMIT = 500;

type Bundle = { v: 1; d: string; e: Record<string, string> };
type Inner = { v: 1; c: string; s: string; t: string };

// ---- base64 and JSON, tolerant of the url-safe and unpadded forms the server can hand back -------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) return fail("INVALID_BASE64");
  const binary = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const jsonB64 = (value: unknown) => bytesToBase64(encoder.encode(JSON.stringify(value)));
const fromJsonB64 = <T>(b64: string): T => JSON.parse(decoder.decode(base64ToBytes(b64))) as T;

export class SecureMessaging {
  /** The core refuses to open the same envelope twice, so what was opened stays here (memory only). */
  private readonly opened = new Map<string,{plaintext:string;ciphertext:string;senderUserId:string}>();

  constructor(private readonly deps: {
    core: ChatCore;
    directory: PeerDirectory;
    /** This device's id as the server knows it. */
    deviceId: () => string;
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
        const pkg = fromJsonB64<KeyPackageJson>(entry.packageBase64);
        await this.deps.core.verifyKeyPackage(pkg);
        if (pkg.user_id !== userId || pkg.device_id !== entry.deviceId || pkg.signing_public_key.length !== 32 || pkg.encryption_public_key.length !== 32 || pkg.pq_encryption_public_key.length === 0) continue;
        out.push({ userId, deviceId: entry.deviceId, pkg });
      } catch { /* a package the core will not accept is not a device to send to */ }
    }
    return out;
  }

  async seal(plaintext: string, context: { conversationId: string; senderUserId: string; clientMessageId: string }): Promise<string> {
    const selfDevice = this.deps.deviceId();
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
      const envelope = await this.deps.core.encryptRaw({
        recipient_encryption_public_key: r.pkg.encryption_public_key,
        recipient_pq_encryption_public_key: r.pkg.pq_encryption_public_key,
        sender_user_id: context.senderUserId, sender_device_id: selfDevice,
        recipient_user_id: r.userId, recipient_device_id: r.deviceId,
        message_id: context.clientMessageId, plaintext: Array.from(encoder.encode(JSON.stringify(inner))),
        created_at_unix: created, expires_at_unix: created + ENVELOPE_LIFETIME_S
      });
      e[r.deviceId] = jsonB64(envelope);
    }
    const bundle: Bundle = { v: 1, d: selfDevice, e };
    return jsonB64(bundle);
  }

  /**
   * Opens one sealed piece sent by another device of the same account (the phone sending older history). The envelope must name this
   * device as its recipient and verify against the sending device's own signing key.
   */
  async openFromOwnDevice(envelopeBytes: Uint8Array, senderUserId: string, senderDeviceId: string): Promise<Uint8Array> {
    const sender = (await this.devicesOf(senderUserId)).find((d) => d.deviceId === senderDeviceId);
    if (!sender) return fail("SENDER_UNKNOWN");
    return this.deps.core.decryptRaw({
      expected_recipient_device_id: this.deps.deviceId(),
      sender_signing_public_key: sender.pkg.signing_public_key,
      envelope: JSON.parse(decoder.decode(envelopeBytes)) as unknown,
      now_unix: this.now()
    });
  }

  async open(ciphertextBase64: string, context: { conversationId: string; senderUserId: string; messageId: string }): Promise<string> {
    const key = `${context.conversationId}:${context.messageId}`;
    const known = this.opened.get(key);
    if(known!==undefined){
      if(known.ciphertext!==ciphertextBase64||known.senderUserId!==context.senderUserId)return fail("MESSAGE_CONTEXT_MISMATCH");
      return known.plaintext;
    }

    const selfDevice = this.deps.deviceId();
    const bundle = fromJsonB64<Bundle>(ciphertextBase64);
    if (bundle?.v !== 1 || typeof bundle.d !== "string" || typeof bundle.e !== "object" || bundle.e === null) return fail("MESSAGE_FORMAT_INVALID");
    const mine = bundle.e[selfDevice];
    if (typeof mine !== "string") return fail("NOT_FOR_THIS_DEVICE");

    // Who sent it: the device the bundle names must be a device of the sender the server says sent it.
    const sender = (await this.devicesOf(context.senderUserId)).find((d) => d.deviceId === bundle.d);
    const signingKey = sender?.pkg.signing_public_key ?? await this.deps.directory.historicalSenderKey?.({...context,senderDeviceId:bundle.d,ciphertextBase64});
    if (!signingKey || signingKey.length!==32 || !signingKey.every(n=>Number.isInteger(n)&&n>=0&&n<=255)) return fail("SENDER_UNKNOWN");
    const plain = await this.deps.core.decryptRaw({
      expected_recipient_device_id: selfDevice,
      sender_signing_public_key: signingKey,
      envelope: fromJsonB64<unknown>(mine),
      now_unix: this.now()
    });
    const inner = JSON.parse(decoder.decode(plain)) as Inner;
    if (inner?.v !== 1 || inner.c !== context.conversationId || inner.s !== context.senderUserId || typeof inner.t !== "string") return fail("MESSAGE_CONTEXT_MISMATCH");
    if (this.opened.size >= CACHE_LIMIT) this.opened.delete(this.opened.keys().next().value as string);
    this.opened.set(key,{plaintext:inner.t,ciphertext:ciphertextBase64,senderUserId:context.senderUserId});
    return inner.t;
  }
}

/**
 * Call encryption on top of linqa-core.
 *
 *  Call key   32 random bytes per call, held in memory only, forgotten at hang-up.
 *  Delivery   KeyEnvelope = linqa-core seal(recipient device, payload || sig),
 *             where sig = Ed25519 over the payload by the sending device.
 *             The payload names sender, recipient, keyId and time, so an
 *             envelope can't be replayed to another device or another call.
 *  Signaling  XChaCha20-Poly1305 under the call key, header as AAD, then the
 *             sender's Ed25519 signature over header || ciphertext. Receivers
 *             check the signature against the key directory, so another
 *             participant can't speak as someone else.
 *  Media      DTLS-SRTP. The DTLS fingerprints travel inside the encrypted,
 *             signed SDP, binding the media keys to Linqa device identities.
 *  Code       12 digits from HKDF(call key). Equal codes on every screen mean
 *             nobody swapped the key in transit.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { KeyEnvelope } from '../protocol';
import type { CallCrypto } from '../ports';
import { b64d, b64e, concat, utf8 } from './bytes';
import type { KeyDirectory, LinqaCoreBinding } from './linqaCore';

const ENV_CTX = 'linqa-call-env-v1';
const SIG_CTX = 'linqa-call-sig-v1';
const SAS_CTX = 'linqa-call-sas-v1';
const ENVELOPE_MAX_AGE_MS = 10 * 60 * 1000;


interface EnvelopePayload {
  v: 1;
  keyId: string;
  key: string; // b64
  from: { u: string; d: string };
  to: { u: string; d: string };
  iat: number;
}

interface SignalHeader {
  v: 1;
  k: string; // keyId
  u: string; // sender user
  d: string; // sender device
  n: string; // b64 nonce (24)
}

export class CallCryptoError extends Error {}

export class LinqaCallCrypto implements CallCrypto {
  private keys = new Map<string, Uint8Array>();
  private seen = new Map<string, Set<string>>();


  constructor(
    private readonly core: LinqaCoreBinding,
    private readonly directory: KeyDirectory,
    private readonly self: { userId: string; deviceId: string },
  ) {}

  async createCallKey(): Promise<string> {
    const keyId = b64e(randomBytes(16)).replace(/[+/=]/g, '').slice(0, 22);
    this.keys.set(keyId, randomBytes(32));
    this.seen.set(keyId, new Set());
    return keyId;
  }

  hasKey(keyId: string): boolean {
    return this.keys.has(keyId);
  }

  async envelopesFor(keyId: string, userIds: string[]): Promise<KeyEnvelope[]> {
    const out: KeyEnvelope[] = [];
    for (const userId of userIds) {
      const devices = await this.directory.devices(userId);
      for (const d of devices) out.push({ userId, deviceId: d.deviceId, envelope: await this.seal(keyId, userId, d.deviceId) });
    }
    return out;
  }

  envelopeForOwnDevice(keyId: string, deviceId: string): Promise<string> {
    return this.seal(keyId, this.self.userId, deviceId);
  }

  async acceptEnvelope(keyId: string, fromUserId: string, fromDeviceId: string, envelope: string): Promise<void> {
    const aad = utf8(`${ENV_CTX}|${keyId}|${this.self.userId}:${this.self.deviceId}`);
    if (envelope.length > 32768) throw new CallCryptoError('envelope-too-large');
    const opened = await this.core.open(b64d(envelope), aad);
    if (opened.length < 65) throw new CallCryptoError('envelope-too-short');
    const body = opened.subarray(0, opened.length - 64);
    const sig = opened.subarray(opened.length - 64);

    const p = JSON.parse(new TextDecoderLite().decode(body)) as EnvelopePayload;
    if (p.v !== 1 || p.keyId !== keyId) throw new CallCryptoError('envelope-wrong-call');
    if (p.to.u !== this.self.userId || p.to.d !== this.self.deviceId) throw new CallCryptoError('envelope-wrong-device');
    if (p.from.u !== fromUserId || p.from.d !== fromDeviceId) throw new CallCryptoError('envelope-wrong-sender');
    if (!Number.isSafeInteger(p.iat)) throw new CallCryptoError('envelope-bad-time');
    if (Math.abs(Date.now() - p.iat) > ENVELOPE_MAX_AGE_MS) throw new CallCryptoError('envelope-expired');

    const pub = await this.signingKey(p.from.u, p.from.d);
    if (!ed25519.verify(sig, concat(utf8(ENV_CTX), body), pub)) throw new CallCryptoError('envelope-bad-signature');

    const key = b64d(p.key);
    if (key.length !== 32) throw new CallCryptoError('envelope-bad-key');
    const existing = this.keys.get(keyId);
    if (existing && !equal(existing, key)) throw new CallCryptoError('envelope-key-mismatch');
    this.keys.set(keyId, key);
    if (!this.seen.has(keyId)) this.seen.set(keyId, new Set());
  }

  async encrypt(keyId: string, plaintext: Uint8Array): Promise<string> {
    const key = this.requireKey(keyId);
    const nonce = randomBytes(24);
    const header: SignalHeader = { v: 1, k: keyId, u: this.self.userId, d: this.self.deviceId, n: b64e(nonce) };
    const aad = utf8(JSON.stringify(header));
    const ct = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
    const sig = await this.core.sign(concat(utf8(SIG_CTX), aad, ct));
    return b64e(utf8(JSON.stringify({ h: header, c: b64e(ct), s: b64e(sig) })));
  }

  async decrypt(keyId: string, wire: string) {
    const key = this.requireKey(keyId);
    if (wire.length > 65536) throw new CallCryptoError('signal-too-large');
    const msg = JSON.parse(new TextDecoderLite().decode(b64d(wire))) as { h: SignalHeader; c: string; s: string };
    const h = msg.h;
    if (!h || h.v !== 1 || h.k !== keyId) throw new CallCryptoError('signal-wrong-call');

    // Rebuild the header ourselves so the AAD is exactly what was signed.
    const header: SignalHeader = { v: 1, k: h.k, u: h.u, d: h.d, n: h.n };
    const aad = utf8(JSON.stringify(header));
    const ct = b64d(msg.c);
    const pub = await this.signingKey(h.u, h.d);
    if (!ed25519.verify(b64d(msg.s), concat(utf8(SIG_CTX), aad, ct), pub)) throw new CallCryptoError('signal-bad-signature');

    const seen = this.seen.get(keyId)!;
    if (seen.has(h.n)) throw new CallCryptoError('signal-replay');
    const plaintext = xchacha20poly1305(key, b64d(h.n), aad).decrypt(ct);
    seen.add(h.n);
    if (seen.size > 100000) { await this.forget(keyId); throw new CallCryptoError('call-replay-limit'); }
    return { senderUserId: h.u, senderDeviceId: h.d, plaintext };
  }

  async verificationCode(keyId: string): Promise<string | null> {
    const key = this.keys.get(keyId);
    if (!key) return null;
    const bytes = hkdf(sha256, key, utf8(keyId), utf8(SAS_CTX), 8);
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    const digits = (n % 10n ** 12n).toString().padStart(12, '0');
    return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
  }

  async forget(keyId: string): Promise<void> {
    this.keys.get(keyId)?.fill(0);
    this.keys.delete(keyId);
    this.seen.delete(keyId);
  }

  /* ---------------------------------------------------------------- */

  private async seal(keyId: string, toUserId: string, toDeviceId: string): Promise<string> {
    const key = this.requireKey(keyId);
    const payload: EnvelopePayload = {
      v: 1,
      keyId,
      key: b64e(key),
      from: { u: this.self.userId, d: this.self.deviceId },
      to: { u: toUserId, d: toDeviceId },
      iat: Date.now(),
    };
    const body = utf8(JSON.stringify(payload));
    const sig = await this.core.sign(concat(utf8(ENV_CTX), body));
    const recipient = await this.directory.device(toUserId, toDeviceId);
    if (!recipient) throw new CallCryptoError('unknown-device');
    const aad = utf8(`${ENV_CTX}|${keyId}|${toUserId}:${toDeviceId}`);
    return b64e(await this.core.seal(recipient, concat(body, sig), aad));
  }

  private requireKey(keyId: string): Uint8Array {
    const k = this.keys.get(keyId);
    if (!k) throw new CallCryptoError('no-call-key');
    return k;
  }

  private async signingKey(userId: string, deviceId: string): Promise<Uint8Array> {
    const d = await this.directory.device(userId, deviceId);
    if (!d) throw new CallCryptoError('unknown-device');
    return d.ed25519;
  }
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i];
  return x === 0;
}

/** Hermes has TextEncoder but not always TextDecoder. */
class TextDecoderLite {
  decode(b: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return decodeURIComponent(escape(bin));
  }
}

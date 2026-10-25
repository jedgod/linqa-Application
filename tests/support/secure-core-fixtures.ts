// Shared fixtures for the secure-messaging tests: a stand-in for the native core plus phones, directories and messaging objects built on
// it. Extracted from secure-core.test.ts so other tests (status video) exercise the same fake and cannot drift from it.
import assert from "node:assert/strict";
import { SecureCoreDevice, SecureCoreError, SecureCoreMessaging, bytesToBase64, type CoreBridge, type KeyPackageJson, type PeerDirectory, type SecretStore } from "../../clients/mobile/services/secure-core.ts";

// A stand-in for the native core that enforces the same rules the real one does (the real one is tested in
// core/tests/native_bridge_contract.rs): an envelope opens only on the device it names, only with the sender's key, and once.
export const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
export const unb64 = (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));
export const NOW_MS = Date.UTC(2026, 9, 6, 12, 0, 0);

export class FakeCore implements CoreBridge {
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

export const mem = (initial: Record<string, string> = {}): SecretStore & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, async protectionLevel() { return "OS_PROTECTED"; }, async get(k) { return data[k] ?? null; }, async put(k, v) { data[k] = v; } };
};
export const enrolled = (deviceId: string, seed: number) => mem({ "device.signingPrivateKey": bytesToBase64(new Uint8Array(32).fill(seed)), "device.encryptionPrivateKey": bytesToBase64(new Uint8Array(32).fill(seed + 1)), "device.id": deviceId });

export type Phone = { core: FakeCore; device: SecureCoreDevice; store: ReturnType<typeof mem>; userId: string; deviceId: string };
export const USER_A = "00000000-0000-4000-8000-0000000000a1";
export const USER_B = "00000000-0000-4000-8000-0000000000b2";
export const CONV = "00000000-0000-4000-8000-0000000000c0";
export function phone(userId: string, deviceId: string, seed: number): Phone {
  const core = new FakeCore(); const store = enrolled(deviceId, seed);
  return { core, store, userId, deviceId, device: new SecureCoreDevice(core, store, userId, () => NOW_MS) };
}
export async function directoryOf(phones: Phone[], extra: Record<string, Array<{ deviceId: string; packageBase64: string }>> = {}): Promise<PeerDirectory> {
  const byUser: Record<string, Array<{ deviceId: string; packageBase64: string }>> = {};
  for (const p of phones) (byUser[p.userId] ??= []).push({ deviceId: p.deviceId, packageBase64: (await p.device.createKeyPackage()).packageBase64 });
  for (const [u, list] of Object.entries(extra)) (byUser[u] ??= []).push(...list);
  return { async keyPackages(u) { return byUser[u] ?? []; } };
}
export const messaging = (p: Phone, directory: PeerDirectory, members = [USER_A, USER_B]) => new SecureCoreMessaging({ bridge: p.core, device: p.device, directory, members: async () => members, now: () => NOW_MS });
export const code = async (promise: Promise<unknown>) => { try { await promise; return "NO_ERROR"; } catch (e) { return e instanceof SecureCoreError ? e.code : `OTHER:${(e as Error).message}`; } };

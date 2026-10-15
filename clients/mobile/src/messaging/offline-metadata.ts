import { gcm } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base64ToBytes, bytesToBase64, text, utf8 } from "../../services/secure-core";

/** Local AES-256-GCM encryption, separate from transport E2EE. Context prevents row/account substitution. */
export class OfflineMetadataCipher {
  constructor(private readonly key: Uint8Array, private readonly accountId: string, private readonly random: (size: number) => Uint8Array) {
    if (key.length !== 32 || !accountId.trim()) throw new Error("OFFLINE_METADATA_KEY_INVALID");
  }

  index(kind: string, value: string): string {
    return bytesToHex(hmac(sha256, this.key, utf8(JSON.stringify(["linqa:offline-index:v1", this.accountId, kind, value]))));
  }

  seal(value: unknown, purpose: string, messageId: string): string {
    const nonce = this.random(12);
    if (nonce.length !== 12) throw new Error("OFFLINE_METADATA_NONCE_INVALID");
    const plain = utf8(JSON.stringify(value));
    try {
      const sealed = gcm(this.key, nonce, this.aad(purpose, messageId)).encrypt(plain);
      return JSON.stringify({ v: 1, iv: bytesToBase64(nonce), ciphertext: bytesToBase64(sealed) });
    } finally { plain.fill(0); }
  }

  open<T>(envelope: string, purpose: string, messageId: string): T {
    let plain: Uint8Array | undefined;
    try {
      const box = JSON.parse(envelope);
      if (box.v !== 1 || typeof box.iv !== "string" || typeof box.ciphertext !== "string") throw new Error();
      const nonce = base64ToBytes(box.iv), sealed = base64ToBytes(box.ciphertext);
      if (nonce.length !== 12 || sealed.length < 16) throw new Error();
      plain = gcm(this.key, nonce, this.aad(purpose, messageId)).decrypt(sealed);
      return JSON.parse(text(plain)) as T;
    } catch { throw new Error("OFFLINE_METADATA_AUTHENTICATION_FAILED"); }
    finally { plain?.fill(0); }
  }

  private aad(purpose: string, messageId: string): Uint8Array {
    return utf8(JSON.stringify(["linqa:offline-metadata:v1", this.accountId, purpose, messageId]));
  }
}

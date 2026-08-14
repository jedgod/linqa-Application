import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope encryption backed by TOKEN_VAULT_KEY_BASE64 (already provisioned
 * for exactly this purpose, but previously only consumed by the
 * fail-closed push token vault stub). AES-256-GCM, nonce prepended to the
 * ciphertext. Shared by the phone-number cipher and the push-token cipher
 * introduced by the multi-account pack.
 */
export class AesGcmCipher {
  constructor(private readonly keyBase64: string) {}

  async encrypt(value: string): Promise<Buffer> {
    const key = Buffer.from(this.keyBase64, "base64");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([nonce, authTag, ciphertext]);
  }

  async decrypt(sealed: Buffer): Promise<string> {
    const key = Buffer.from(this.keyBase64, "base64");
    const nonce = sealed.subarray(0, 12);
    const authTag = sealed.subarray(12, 28);
    const ciphertext = sealed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}

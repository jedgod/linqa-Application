import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import type { AppConfig } from "../../../config.js";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export class CountryLinqaCrypto {
  private readonly keyRing: Record<number, Buffer> = {};
  private readonly activeKeyVersion = 1;

  constructor(config: AppConfig) {
    if (config.COUNTRYLINQA_DATA_KEY_V1) {
      this.keyRing[1] = Buffer.from(config.COUNTRYLINQA_DATA_KEY_V1, "hex");
    }
  }

  encryptJson(payload: unknown): { version: number; blob: Buffer } {
    const key = this.keyRing[this.activeKeyVersion];
    if (!key) {
      const error: any = new Error("Sensitive-evidence encryption key not configured.");
      error.status = 500;
      error.code = "ACTIVE_KEY_VERSION_NOT_FOUND";
      throw error;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { version: this.activeKeyVersion, blob: Buffer.concat([iv, authTag, ciphertext]) };
  }

  decryptJson<T>(version: number, blob: Buffer): T {
    const key = this.keyRing[version];
    if (!key) {
      const error: any = new Error(`Encryption key version ${version} unavailable.`);
      error.status = 500;
      error.code = "KEY_VERSION_UNAVAILABLE";
      throw error;
    }
    const iv = blob.subarray(0, 12);
    const authTag = blob.subarray(12, 28);
    const ciphertext = blob.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  }
}

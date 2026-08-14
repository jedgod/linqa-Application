import { createHash, createHmac } from "node:crypto";

export function sha256(data: Uint8Array | string): Buffer {
  return createHash("sha256").update(data).digest();
}

export function hmacSha256(secret: string, data: Uint8Array | string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function hashIp(secret: string, ip: string): Buffer {
  return hmacSha256(secret, `ip:${ip}`);
}

import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

export interface GeneratedOtp {
  code: string;
  salt: Buffer;
  hash: Buffer;
}

export function generateOtp(): GeneratedOtp {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const salt = randomBytes(16);
  const hash = scryptSync(code, salt, 32, {
    N: 16384,
    r: 8,
    p: 1
  });
  return { code, salt, hash };
}

export function verifyOtp(code: string, salt: Buffer, expectedHash: Buffer): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const actual = scryptSync(code, salt, 32, {
    N: 16384,
    r: 8,
    p: 1
  });
  return actual.length === expectedHash.length && timingSafeEqual(actual, expectedHash);
}

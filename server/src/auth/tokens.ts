import { randomBytes, createHash } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import type { AppConfig } from "../config.js";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export async function issueAccessToken(
  config: AppConfig,
  input: {
    userId: string;
    subject: string;
    deviceId?: string;
    scopes: string[];
    sessionId: string;
  }
): Promise<string> {
  const productionSigning = config.JWT_SIGNING_PRIVATE_KEY_PEM
    ? await importPKCS8(config.JWT_SIGNING_PRIVATE_KEY_PEM, "EdDSA")
    : null;
  if (config.NODE_ENV === "production" && !productionSigning) {
    throw new Error("production JWT signing key is not configured");
  }
  const key = productionSigning ?? new TextEncoder().encode(config.JWT_HS256_SECRET);
  const algorithm = productionSigning ? "EdDSA" : "HS256";
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    user_id: input.userId,
    device_id: input.deviceId,
    scope: input.scopes.join(" "),
    sid: input.sessionId
  })
    .setProtectedHeader({ alg: algorithm, typ: "JWT" })
    .setSubject(input.subject)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .setJti(crypto.randomUUID())
    .sign(key);
}

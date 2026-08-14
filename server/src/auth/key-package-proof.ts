import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { z } from "zod";

const DOMAIN = Buffer.from("linqa:key-package:v1", "utf8");
const CURRENT_VERSION = 2;
const MAX_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const byte = z.number().int().min(0).max(255);
const KeyPackageSchema = z.object({
  version: z.literal(CURRENT_VERSION),
  user_id: z.string().uuid(),
  device_id: z.string().uuid(),
  signing_public_key: z.array(byte).length(32),
  encryption_public_key: z.array(byte).length(32),
  pq_encryption_public_key: z.array(byte).length(1184),
  created_at_unix: z.number().int().safe(),
  expires_at_unix: z.number().int().safe(),
  signature: z.array(byte).length(64)
}).strict();

export type SignedKeyPackage = z.infer<typeof KeyPackageSchema>;

export function parseAndVerifyKeyPackage(input: {
  packageBytes: Buffer;
  expectedUserId: string;
  expectedDeviceId: string;
  enrolledSigningPublicKey: Buffer;
  nowUnix?: number;
}): SignedKeyPackage {
  const parsed = KeyPackageSchema.parse(JSON.parse(input.packageBytes.toString("utf8")));
  const nowUnix = input.nowUnix ?? Math.floor(Date.now() / 1000);
  const signingKey = Buffer.from(parsed.signing_public_key);

  if (parsed.user_id !== input.expectedUserId || parsed.device_id !== input.expectedDeviceId) {
    throw new Error("key package identity mismatch");
  }
  if (!signingKey.equals(input.enrolledSigningPublicKey)) {
    throw new Error("key package is not signed by the enrolled device key");
  }
  if (parsed.created_at_unix > nowUnix + 300 || parsed.expires_at_unix <= nowUnix) {
    throw new Error("key package is not currently valid");
  }
  if (parsed.expires_at_unix <= parsed.created_at_unix ||
      parsed.expires_at_unix - parsed.created_at_unix > MAX_LIFETIME_SECONDS) {
    throw new Error("invalid key package lifetime");
  }

  const version = Buffer.alloc(2);
  version.writeUInt16BE(parsed.version);
  const createdAt = Buffer.alloc(8);
  createdAt.writeBigInt64BE(BigInt(parsed.created_at_unix));
  const expiresAt = Buffer.alloc(8);
  expiresAt.writeBigInt64BE(BigInt(parsed.expires_at_unix));
  const digest = createHash("sha256")
    .update(DOMAIN)
    .update(version)
    .update(Buffer.from(parsed.user_id, "utf8"))
    .update(Buffer.from(parsed.device_id, "utf8"))
    .update(signingKey)
    .update(Buffer.from(parsed.encryption_public_key))
    .update(Buffer.from(parsed.pq_encryption_public_key))
    .update(createdAt)
    .update(expiresAt)
    .digest();

  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: signingKey.toString("base64url") },
    format: "jwk"
  });
  if (!cryptoVerify(null, digest, publicKey, Buffer.from(parsed.signature))) {
    throw new Error("invalid key package signature");
  }
  return parsed;
}

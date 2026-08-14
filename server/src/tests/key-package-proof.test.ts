import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseAndVerifyKeyPackage } from "../auth/key-package-proof.js";

const DOMAIN = Buffer.from("linqa:key-package:v1");
const userId = "11111111-1111-4111-8111-111111111111";
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function signedPackage() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  const signingKey = Buffer.from(jwk.x!, "base64url");
  const now = Math.floor(Date.now() / 1000);
  const fields = {
    version: 2 as const,
    user_id: userId,
    device_id: deviceId,
    signing_public_key: [...signingKey],
    encryption_public_key: [...Buffer.alloc(32, 7)],
    pq_encryption_public_key: [...Buffer.alloc(1184, 9)],
    created_at_unix: now,
    expires_at_unix: now + 3600,
    signature: [] as number[]
  };
  const version = Buffer.alloc(2); version.writeUInt16BE(fields.version);
  const created = Buffer.alloc(8); created.writeBigInt64BE(BigInt(fields.created_at_unix));
  const expires = Buffer.alloc(8); expires.writeBigInt64BE(BigInt(fields.expires_at_unix));
  const digest = createHash("sha256")
    .update(DOMAIN).update(version).update(userId).update(deviceId)
    .update(signingKey).update(Buffer.from(fields.encryption_public_key))
    .update(Buffer.from(fields.pq_encryption_public_key)).update(created).update(expires).digest();
  fields.signature = [...sign(null, digest, privateKey)];
  return { fields, signingKey, now };
}

describe("signed key-package boundary", () => {
  it("accepts a canonical package signed by the enrolled device", () => {
    const fixture = signedPackage();
    expect(parseAndVerifyKeyPackage({
      packageBytes: Buffer.from(JSON.stringify(fixture.fields)),
      expectedUserId: userId,
      expectedDeviceId: deviceId,
      enrolledSigningPublicKey: fixture.signingKey,
      nowUnix: fixture.now
    }).version).toBe(2);
  });

  it("rejects package tampering", () => {
    const fixture = signedPackage();
    fixture.fields.encryption_public_key[0] = fixture.fields.encryption_public_key[0]! ^ 1;
    expect(() => parseAndVerifyKeyPackage({
      packageBytes: Buffer.from(JSON.stringify(fixture.fields)),
      expectedUserId: userId,
      expectedDeviceId: deviceId,
      enrolledSigningPublicKey: fixture.signingKey,
      nowUnix: fixture.now
    })).toThrow("invalid key package signature");
  });
});

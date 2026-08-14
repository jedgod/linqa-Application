import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

const DOMAIN = Buffer.from("linqa:device-enrollment:v1", "utf8");

export interface EnrollmentChallengeFields {
  challengeId: string;
  userId: string;
  nonce: Buffer;
  expiresAtUnix: bigint;
}

export interface EnrollmentProofDigestFields {
  deviceName: string;
  platform: string;
  signingPublicKey: Buffer;
  encryptionPublicKey: Buffer;
}

export interface EnrollmentProofFields extends EnrollmentProofDigestFields {
  signature: Buffer;
}

/**
 * Byte-for-byte reimplementation of core/src/enrollment.rs's canonical_bytes,
 * so a submitted proof can be verified without a native/WASM core binding.
 * Field order and encoding (raw UTF-8, no length prefixes; nonce/keys as raw
 * bytes; expiry as big-endian i64 seconds) must stay in lockstep with the
 * Rust source.
 */
export function canonicalEnrollmentDigest(
  challenge: EnrollmentChallengeFields,
  proof: EnrollmentProofDigestFields
): Buffer {
  const expiresAtBytes = Buffer.alloc(8);
  expiresAtBytes.writeBigInt64BE(challenge.expiresAtUnix);

  const hash = createHash("sha256");
  hash.update(DOMAIN);
  hash.update(Buffer.from(challenge.challengeId, "utf8"));
  hash.update(Buffer.from(challenge.userId, "utf8"));
  hash.update(challenge.nonce);
  hash.update(expiresAtBytes);
  hash.update(Buffer.from(proof.deviceName, "utf8"));
  hash.update(Buffer.from(proof.platform, "utf8"));
  hash.update(proof.signingPublicKey);
  hash.update(proof.encryptionPublicKey);
  return hash.digest();
}

export function verifyEnrollmentProof(
  challenge: EnrollmentChallengeFields,
  proof: EnrollmentProofFields
): boolean {
  if (proof.signingPublicKey.length !== 32 || proof.encryptionPublicKey.length !== 32) return false;
  if (proof.signature.length !== 64) return false;

  const digest = canonicalEnrollmentDigest(challenge, proof);

  let publicKey;
  try {
    publicKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: proof.signingPublicKey.toString("base64url") },
      format: "jwk"
    });
  } catch {
    return false;
  }

  try {
    return cryptoVerify(null, digest, publicKey, proof.signature);
  } catch {
    return false;
  }
}

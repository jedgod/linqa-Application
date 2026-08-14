import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalEnrollmentDigest, verifyEnrollmentProof } from "../auth/enrollment-proof.js";

function makeSignedProof() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublicKey = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);

  const challenge = {
    challengeId: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    nonce: Buffer.alloc(32, 7),
    expiresAtUnix: 2_000_000_000n
  };
  const proofFields = {
    deviceName: "Test Device",
    platform: "WEB",
    signingPublicKey: rawPublicKey,
    encryptionPublicKey: Buffer.alloc(32, 9)
  };

  const digest = canonicalEnrollmentDigest(challenge, proofFields);
  const signature = cryptoSign(null, digest, privateKey);

  return { challenge, proof: { ...proofFields, signature } };
}

describe("verifyEnrollmentProof", () => {
  it("accepts a validly signed proof matching the Rust core's canonical_bytes layout", () => {
    const { challenge, proof } = makeSignedProof();
    expect(verifyEnrollmentProof(challenge, proof)).toBe(true);
  });

  it("rejects a proof with a tampered device name", () => {
    const { challenge, proof } = makeSignedProof();
    expect(
      verifyEnrollmentProof(challenge, { ...proof, deviceName: "Different Device" })
    ).toBe(false);
  });

  it("rejects a proof with a tampered signature", () => {
    const { challenge, proof } = makeSignedProof();
    const tampered = Buffer.from(proof.signature);
    tampered.writeUInt8(tampered.readUInt8(0) ^ 0xff, 0);
    expect(verifyEnrollmentProof(challenge, { ...proof, signature: tampered })).toBe(false);
  });

  it("rejects a proof signed for a different challenge (different expiry)", () => {
    const { challenge, proof } = makeSignedProof();
    expect(
      verifyEnrollmentProof({ ...challenge, expiresAtUnix: challenge.expiresAtUnix + 1n }, proof)
    ).toBe(false);
  });
});

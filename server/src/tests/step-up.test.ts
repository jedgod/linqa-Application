import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StepUpService } from "../security/step-up.js";

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const consumed = new Set<string>();
  return new StepUpService(
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey.export({ type: "spki", format: "pem" }).toString(),
    { consumeOnce: async (jti) => !consumed.has(jti) && Boolean(consumed.add(jti)) }
  );
}

describe("cryptographic single-use step-up", () => {
  const expected = {
    userId: "11111111-1111-4111-8111-111111111111",
    deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    action: "ACCOUNT_DELETE" as const
  };

  it("verifies an action/user/device-bound token exactly once", async () => {
    const service = fixture();
    const token = service.issue({ ...expected, authn: "PASSKEY" });
    await expect(service.verifyAndConsume(token, expected)).resolves.toMatchObject({ action: "ACCOUNT_DELETE" });
    await expect(service.verifyAndConsume(token, expected)).rejects.toThrow("STEP_UP_REPLAYED");
  });

  it("rejects action binding and signature tampering", async () => {
    const service = fixture();
    const token = service.issue({ ...expected, authn: "DEVICE_PROOF" });
    await expect(service.verifyAndConsume(token, { ...expected, action: "DATA_EXPORT" })).rejects.toThrow("STEP_UP_BINDING_FAILED");
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    await expect(service.verifyAndConsume(tampered, expected)).rejects.toThrow("STEP_UP_SIGNATURE_INVALID");
  });
});


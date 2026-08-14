import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { AesGcmCipher } from "../crypto/symmetric-cipher.js";
import { AccountLimitService, MAX_ACCOUNTS_PER_INSTALLATION } from "../services/account-limit.service.js";
import { PhoneRiskService } from "../services/phone-risk.service.js";
import { KeyTransparencyV2Service } from "../services/key-transparency-v2.service.js";
import { createHash } from "node:crypto";

describe("AesGcmCipher", () => {
  it("round-trips a value through encrypt/decrypt", async () => {
    const cipher = new AesGcmCipher(Buffer.alloc(32, 7).toString("base64"));
    const sealed = await cipher.encrypt("+12025550123");
    expect(sealed.length).toBeGreaterThan(28);

    const plaintext = await cipher.decrypt(sealed);
    expect(plaintext).toBe("+12025550123");
  });

  it("produces different ciphertext for the same plaintext (random nonce)", async () => {
    const cipher = new AesGcmCipher(Buffer.alloc(32, 3).toString("base64"));
    const a = await cipher.encrypt("same-value");
    const b = await cipher.encrypt("same-value");
    expect(a.equals(b)).toBe(false);
  });

  it("fails to decrypt with a tampered ciphertext", async () => {
    const cipher = new AesGcmCipher(Buffer.alloc(32, 9).toString("base64"));
    const sealed = await cipher.encrypt("secret");
    sealed.writeUInt8(sealed.readUInt8(sealed.length - 1) ^ 0xff, sealed.length - 1);
    await expect(cipher.decrypt(sealed)).rejects.toThrow();
  });
});

describe("AccountLimitService", () => {
  it("allows adding up to the 3-account maximum", async () => {
    const query = vi.fn(async () => ({ rows: [{ count: 2 }] }));
    const service = new AccountLimitService({ query } as unknown as Database);
    await expect(service.requireCapacity("installation-1")).resolves.toBeUndefined();
  });

  it("rejects and logs a 4th account attempt", async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("count(*)")) return { rows: [{ count: MAX_ACCOUNTS_PER_INSTALLATION }] };
      return { rows: [] };
    });
    const service = new AccountLimitService({ query } as unknown as Database);

    await expect(service.requireCapacity("installation-1")).rejects.toThrow("ACCOUNT_LIMIT_REACHED");
    expect(calls.some((c) => c.sql.includes("ACCOUNT_LIMIT_REJECTED"))).toBe(true);
  });

  it("finds the next available slot, skipping ones in use", async () => {
    const query = vi.fn(async () => ({ rows: [{ account_slot: 1 }] }));
    const service = new AccountLimitService({ query } as unknown as Database);
    await expect(service.nextAvailableSlot("installation-1")).resolves.toBe(2);
  });
});

describe("PhoneRiskService", () => {
  const risk = new PhoneRiskService();

  it("rejects a known VoIP line outright", () => {
    const result = risk.evaluate({
      valid: true,
      lineType: "VOIP",
      recentOtpFailures: 0,
      recentNumberAttempts: 0
    });
    expect(result.decision).toBe("REJECT");
    expect(result.reasons).toContain("INELIGIBLE_LINE_TYPE");
  });

  it("rejects a disposable-flagged mobile line even if lineType looks eligible", () => {
    const result = risk.evaluate({
      valid: true,
      lineType: "MOBILE",
      disposable: true,
      recentOtpFailures: 0,
      recentNumberAttempts: 0
    });
    expect(result.decision).toBe("REJECT");
  });

  it("allows a clean mobile line with no risk signals", () => {
    const result = risk.evaluate({
      valid: true,
      lineType: "MOBILE",
      recentOtpFailures: 0,
      recentNumberAttempts: 0
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.score).toBe(0);
  });

  it("sends an ambiguous line type to review, not outright rejection", () => {
    const result = risk.evaluate({
      valid: true,
      lineType: "UNKNOWN",
      recentOtpFailures: 0,
      recentNumberAttempts: 0
    });
    expect(result.decision).toBe("REVIEW");
  });

  it("escalates to REJECT once accumulated risk score crosses 70", () => {
    const result = risk.evaluate({
      valid: true,
      lineType: "MOBILE_PORTED",
      ported: true,
      simSwapRisk: "HIGH",
      providerRiskScore: 20,
      recentOtpFailures: 5,
      recentNumberAttempts: 5
    });
    expect(result.decision).toBe("REJECT");
  });
});

describe("KeyTransparencyV2Service.verifyLeafHash", () => {
  const service = new KeyTransparencyV2Service({} as unknown as Database);

  it("accepts a leaf hash matching userId+deviceId+keyBytes", () => {
    const keyBytes = Buffer.from("device-public-key");
    const expected = createHash("sha256").update("user-1").update("device-1").update(keyBytes).digest();

    expect(
      service.verifyLeafHash({
        userId: "user-1",
        deviceId: "device-1",
        keyBytes,
        expectedLeafHash: expected
      })
    ).toBe(true);
  });

  it("rejects a leaf hash computed for a different device", () => {
    const keyBytes = Buffer.from("device-public-key");
    const expected = createHash("sha256").update("user-1").update("device-1").update(keyBytes).digest();

    expect(
      service.verifyLeafHash({
        userId: "user-1",
        deviceId: "device-2",
        keyBytes,
        expectedLeafHash: expected
      })
    ).toBe(false);
  });
});

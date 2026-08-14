import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { EnrollmentV2Service } from "../services/enrollment-v2.service.js";

describe("EnrollmentV2Service", () => {
  it("creates a linked-device approval challenge scoped to the approving device", async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      expect(sql).toContain("INSERT INTO enrollment_challenges_v2");
      expect(params?.[1]).toBe("approving-device-1");
      expect(params?.[2]).toBe("requested-device-1");
      return {
        rows: [{ id: "challenge-1", expires_at: "2026-01-01T00:05:00.000Z" }],
        rowCount: 1
      };
    });
    const service = new EnrollmentV2Service({ query } as unknown as Database);

    const result = await service.createChallenge({
      userId: "user-1",
      approvingDeviceId: "approving-device-1",
      requestedDeviceId: "requested-device-1"
    });

    expect(result.id).toBe("challenge-1");
    expect(result.challengeBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("refuses to approve without a real core-verified proof", async () => {
    const query = vi.fn();
    const service = new EnrollmentV2Service({ query } as unknown as Database);

    await expect(
      service.approve({
        userId: "user-1",
        approvingDeviceId: "approving-device-1",
        challengeId: "challenge-1",
        coreVerified: false,
        requestedDeviceKeyPackage: Buffer.alloc(64)
      })
    ).rejects.toThrow("core enrollment proof verification failed");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects an undersized requested-device key package even if core-verified", async () => {
    const query = vi.fn();
    const service = new EnrollmentV2Service({ query } as unknown as Database);

    await expect(
      service.approve({
        userId: "user-1",
        approvingDeviceId: "approving-device-1",
        challengeId: "challenge-1",
        coreVerified: true,
        requestedDeviceKeyPackage: Buffer.alloc(8)
      })
    ).rejects.toThrow("invalid requested-device key package");
    expect(query).not.toHaveBeenCalled();
  });
});

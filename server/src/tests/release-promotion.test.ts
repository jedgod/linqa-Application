import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { ReleasePromotionService } from "../services/release-promotion.service.js";

describe("ReleasePromotionService", () => {
  it("rejects self-approval before evaluating gates or activating a feature", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("FROM milestone_promotions")) {
        return {
          rows: [{
            status: "PENDING",
            requested_by: "release-operator",
            milestone_code: "1.0",
            feature_key: "secureMessaging",
            rollout_percentage: 5
          }],
          rowCount: 1
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const release = vi.fn();
    const database = {
      connect: async () => ({ query, release })
    } as unknown as Database;

    const service = new ReleasePromotionService(database);
    await expect(service.approve({
      promotionId: "00000000-0000-4000-8000-000000000001",
      approvedBy: "release-operator"
    })).rejects.toThrow("cannot approve their own request");

    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
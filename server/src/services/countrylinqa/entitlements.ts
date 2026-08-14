import type { Database } from "../../db/pool.js";
import type { AppConfig } from "../../config.js";

export type SubscriptionTier = "FREE" | "PREMIUM" | "ELITE";
export type DiscoveryMode = "MY_COUNTRY" | "SELECTED_COUNTRIES" | "REGION" | "GLOBAL";

export function discoveryEntitlements(tier: SubscriptionTier): Record<DiscoveryMode, boolean> {
  return {
    MY_COUNTRY: true,
    SELECTED_COUNTRIES: tier === "PREMIUM" || tier === "ELITE",
    REGION: tier === "PREMIUM" || tier === "ELITE",
    GLOBAL: tier === "ELITE"
  };
}

export interface SubscriptionProvider {
  getTier(userId: string): Promise<SubscriptionTier>;
}

/** Real implementation, reading the real billing tables
 * (`subscription_accounts`, `EntitlementService`'s domain) instead of the
 * pack's DatabaseSubscriptionProvider stub, which always returned "FREE". */
export class RealSubscriptionProvider implements SubscriptionProvider {
  constructor(private readonly db: Database) {}

  async getTier(userId: string): Promise<SubscriptionTier> {
    const result = await this.db.query(
      `SELECT plan_code, status FROM subscription_accounts WHERE user_id = $1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row || !["ACTIVE", "TRIAL", "GRACE"].includes(row.status)) {
      return "FREE";
    }
    const code = String(row.plan_code ?? "").toUpperCase();
    if (code === "ELITE") return "ELITE";
    if (code === "PREMIUM") return "PREMIUM";
    return "FREE";
  }
}

export function assertEntitled(
  tier: SubscriptionTier,
  mode: DiscoveryMode,
  countryCount: number,
  regionCount: number,
  config: AppConfig
): void {
  if (tier === "FREE") {
    if (mode !== "MY_COUNTRY" || countryCount > 0 || regionCount > 0) {
      const error: any = new Error("Upgrade required for this discovery scope.");
      error.status = 403;
      error.code = "UPGRADE_REQUIRED";
      throw error;
    }
    return;
  }

  if (tier === "PREMIUM") {
    if (mode === "GLOBAL") {
      const error: any = new Error("Upgrade required for global discovery.");
      error.status = 403;
      error.code = "UPGRADE_REQUIRED";
      throw error;
    }
    if (countryCount > config.COUNTRY_SELECTION_PREMIUM_LIMIT) {
      const error: any = new Error("Country selection limit exceeded.");
      error.status = 422;
      error.code = "COUNTRY_LIMIT_EXCEEDED";
      throw error;
    }
    if (regionCount > 10) {
      const error: any = new Error("Region selection limit exceeded.");
      error.status = 422;
      error.code = "REGION_LIMIT_EXCEEDED";
      throw error;
    }
  }
}

import { createHash } from "node:crypto";

export type MobileLineType =
  | "MOBILE"
  | "CELLULAR"
  | "WIRELESS"
  | "MOBILE_PORTED"
  | "UNKNOWN"
  | "VOIP"
  | "FIXED_VOIP"
  | "HOSTED"
  | "DISPOSABLE"
  | "TEMPORARY"
  | "VIRTUAL"
  | "TOLL_FREE"
  | "PREMIUM_RATE"
  | "PAGER"
  | "INVALID";

export interface MobileLineIntelligenceProvider {
  lookup(e164: string): Promise<{
    providerReference: string;
    valid: boolean;
    lineType: MobileLineType;
    carrierName?: string;
    countryIso2?: string;
    mobileCountryCode?: string;
    mobileNetworkCode?: string;
    disposable?: boolean;
    voip?: boolean;
    hosted?: boolean;
    ported?: boolean;
    simSwapRisk?: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
    riskScore?: number;
  }>;
}

/** No carrier/line-intelligence provider is configured in this environment (see APPLY_GUIDE.txt item 5). */
export class FailClosedMobileLineIntelligenceProvider implements MobileLineIntelligenceProvider {
  async lookup(): Promise<never> {
    throw new Error("mobile line intelligence provider is not configured");
  }
}

/**
 * Development-only stand-in, same precedent as
 * `services/delivery/dev-console.provider.ts`'s DevConsoleDeliveryProvider:
 * no real carrier-intelligence provider is configured, and without one
 * `/v5/phone-verification/start` can never succeed (FailClosedMobileLineIntelligenceProvider
 * always throws), which blocks the entire multi-account vertical in every
 * environment. Returns a plausible always-eligible MOBILE line so
 * PhoneRiskService naturally scores it ALLOW — the real risk-scoring logic
 * itself is untouched.
 */
export class DevMobileLineIntelligenceProvider implements MobileLineIntelligenceProvider {
  constructor(config: { NODE_ENV: string }) {
    if (config.NODE_ENV === "production") {
      throw new Error(
        "DevMobileLineIntelligenceProvider must not be used in production; configure a real carrier-intelligence provider."
      );
    }
  }

  async lookup(e164: string): Promise<Awaited<ReturnType<MobileLineIntelligenceProvider["lookup"]>>> {
    return {
      providerReference: `dev-${createHash("sha256").update(e164).digest("hex").slice(0, 16)}`,
      valid: true,
      lineType: "MOBILE",
      carrierName: "Dev Carrier",
      ...(e164.startsWith("+1") ? { countryIso2: "US" } : {}),
      disposable: false,
      voip: false,
      hosted: false,
      ported: false,
      simSwapRisk: "LOW",
      riskScore: 0
    };
  }
}

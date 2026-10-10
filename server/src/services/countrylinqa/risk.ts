export type CountryEvidence = {
  phoneCountryCode?: string | null;
  carrierCountryCode?: string | null;
  simCountryCode?: string | null;
  ipCountryCode?: string | null;
  localeCountryCode?: string | null;
  claimedCountryCode?: string | null;
  lineType?: string | null;
  phoneVerified: boolean;
};

export type CountryRiskResult = {
  score: number;
  reasons: string[];
  state: "VERIFIED" | "UNVERIFIED" | "REVIEW_REQUIRED" | "RESTRICTED";
};

const UNSUPPORTED_LINE_TYPES = new Set(["VOIP", "VIRTUAL", "DISPOSABLE", "TEMPORARY"]);

export function evaluateCountryRisk(e: CountryEvidence): CountryRiskResult {
  let score = 0;
  const reasons: string[] = [];

  if (!e.phoneVerified || !e.phoneCountryCode) {
    score += 50;
    reasons.push("PHONE_NOT_VERIFIED");
  }
  if (e.lineType && UNSUPPORTED_LINE_TYPES.has(e.lineType)) {
    score += 70;
    reasons.push("UNSUPPORTED_LINE_TYPE");
  }
  if (e.carrierCountryCode && e.phoneCountryCode && e.carrierCountryCode !== e.phoneCountryCode) {
    score += 20;
    reasons.push("CARRIER_PHONE_COUNTRY_MISMATCH");
  }
  if (e.ipCountryCode && e.phoneCountryCode && e.ipCountryCode !== e.phoneCountryCode) {
    score += 5;
    reasons.push("IP_PHONE_COUNTRY_MISMATCH");
  }

  score = Math.min(score, 100);

  let state: CountryRiskResult["state"];
  if (score >= 80) state = "RESTRICTED";
  else if (score >= 40) state = "REVIEW_REQUIRED";
  else if (e.phoneVerified && e.phoneCountryCode) state = "VERIFIED";
  else state = "UNVERIFIED";

  return { score, reasons, state };
}

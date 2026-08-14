import type { MobileLineType } from "./mobile-line-intelligence.service.js";

const ALLOWED = new Set<MobileLineType>(["MOBILE", "CELLULAR", "WIRELESS"]);

const REVIEW = new Set<MobileLineType>(["MOBILE_PORTED", "UNKNOWN"]);

const REJECTED = new Set<MobileLineType>([
  "VOIP",
  "FIXED_VOIP",
  "HOSTED",
  "DISPOSABLE",
  "TEMPORARY",
  "VIRTUAL",
  "TOLL_FREE",
  "PREMIUM_RATE",
  "PAGER",
  "INVALID"
]);

export class PhoneRiskService {
  evaluate(input: {
    valid: boolean;
    lineType: MobileLineType;
    disposable?: boolean;
    voip?: boolean;
    hosted?: boolean;
    ported?: boolean;
    simSwapRisk?: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
    providerRiskScore?: number;
    recentOtpFailures: number;
    recentNumberAttempts: number;
  }) {
    const reasons: string[] = [];

    if (!input.valid) {
      reasons.push("INVALID_NUMBER");
      return { decision: "REJECT" as const, score: 100, reasons };
    }

    if (REJECTED.has(input.lineType) || input.disposable === true || input.voip === true || input.hosted === true) {
      reasons.push("INELIGIBLE_LINE_TYPE");
      return { decision: "REJECT" as const, score: 100, reasons };
    }

    let score = Math.max(0, Math.min(input.providerRiskScore ?? 0, 100));

    if (REVIEW.has(input.lineType)) {
      score += 25;
      reasons.push("AMBIGUOUS_LINE_TYPE");
    }

    if (input.ported === true) {
      score += 10;
      reasons.push("RECENT_OR_PORTED_NUMBER");
    }

    if (input.simSwapRisk === "HIGH") {
      score += 30;
      reasons.push("SIM_SWAP_HIGH");
    } else if (input.simSwapRisk === "MEDIUM") {
      score += 15;
      reasons.push("SIM_SWAP_MEDIUM");
    }

    score += Math.min(input.recentOtpFailures * 5, 20);
    score += Math.min(input.recentNumberAttempts * 3, 15);

    score = Math.min(100, score);

    if (score >= 70) {
      return { decision: "REJECT" as const, score, reasons: [...reasons, "RISK_SCORE_HIGH"] };
    }

    if (score >= 35 || !ALLOWED.has(input.lineType)) {
      return { decision: "REVIEW" as const, score, reasons };
    }

    return { decision: "ALLOW" as const, score, reasons };
  }
}

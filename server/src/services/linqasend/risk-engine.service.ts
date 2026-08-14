export type RiskDecision = "ALLOW" | "ALLOW_STEP_UP" | "REVIEW" | "TEMPORARY_HOLD" | "DECLINE" | "FREEZE_ACCOUNT";

/** Ported near-verbatim from the LinqaSend pack — pure scoring logic, no
 * external provider dependency, so it needs no fail-closed adapter. */
export class RiskEngineService {
  evaluate(input: {
    amountMinor: bigint;
    isNewRecipient: boolean;
    isNewPaymentMethod: boolean;
    accountAgeDays: number;
    recentPasswordReset: boolean;
    recentSimChange: boolean;
    velocity24hMinor: bigint;
    deviceTrusted: boolean;
    countryRiskScore: number;
  }): { score: number; decision: RiskDecision; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    const add = (points: number, reason: string) => {
      score += points;
      reasons.push(reason);
    };

    if (input.isNewRecipient) add(12, "NEW_RECIPIENT");
    if (input.isNewPaymentMethod) add(15, "NEW_PAYMENT_METHOD");
    if (input.accountAgeDays < 7) add(15, "YOUNG_ACCOUNT");
    if (input.recentPasswordReset) add(20, "RECENT_PASSWORD_RESET");
    if (input.recentSimChange) add(25, "RECENT_SIM_CHANGE");
    if (!input.deviceTrusted) add(15, "UNTRUSTED_DEVICE");
    if (input.amountMinor >= 100_000n) add(10, "HIGH_VALUE_TRANSFER");
    if (input.velocity24hMinor >= 500_000n) add(20, "HIGH_24H_VELOCITY");
    if (input.countryRiskScore > 70) add(20, "HIGH_COUNTRY_RISK");

    if (score >= 80) return { score, decision: "DECLINE", reasons };
    if (score >= 60) return { score, decision: "TEMPORARY_HOLD", reasons };
    if (score >= 40) return { score, decision: "REVIEW", reasons };
    if (score >= 20) return { score, decision: "ALLOW_STEP_UP", reasons };
    return { score, decision: "ALLOW", reasons };
  }
}

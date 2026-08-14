import type { Database } from "../db/pool.js";

export class AbuseDecisionService {
  constructor(private readonly db: Database) {}

  async evaluate(input: {
    userId?: string;
    deviceId?: string;
    action: string;
    failedAuthCount: number;
    messageRatePerMinute: number;
    deviceRiskScore: number;
    knownAbuseSignals: number;
  }) {
    const score = Math.min(
      100,
      input.failedAuthCount * 8 +
        Math.max(0, input.messageRatePerMinute - 60) +
        input.deviceRiskScore +
        input.knownAbuseSignals * 15
    );
    const decision =
      score >= 85 ? "DENY" : score >= 65 ? "CHALLENGE" : score >= 45 ? "THROTTLE" : "ALLOW";
    const reasons: string[] = [];
    if (input.failedAuthCount > 3) reasons.push("AUTH_FAILURE_BURST");
    if (input.messageRatePerMinute > 60) reasons.push("MESSAGE_RATE_HIGH");
    if (input.deviceRiskScore > 30) reasons.push("DEVICE_RISK_HIGH");
    if (input.knownAbuseSignals > 0) reasons.push("KNOWN_ABUSE_SIGNAL");

    await this.db.query(
      `INSERT INTO abuse_decisions (
         user_id,device_id,action,risk_score,decision,reason_codes
       ) VALUES($1,$2,$3,$4,$5,$6)`,
      [input.userId ?? null, input.deviceId ?? null, input.action, score, decision, reasons]
    );
    return { score, decision, reasons };
  }
}
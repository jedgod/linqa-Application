import type { Database } from "../../../db/pool.js";
import { hasActivePolicyAction } from "./policy.js";
import { securityLog } from "./security-log.js";

export async function guardCountrySensitiveChange(
  db: Database,
  input: { userId: string; operation: string; deviceTrust: string; stepUpSatisfied: boolean; riskScore: number }
): Promise<true> {
  if (await hasActivePolicyAction(db, input.userId, "COUNTRY_CHANGES_BLOCKED")) {
    const error: any = new Error("Country changes are blocked for this account.");
    error.status = 403;
    error.code = "COUNTRY_CHANGE_BLOCKED";
    throw error;
  }

  if (input.deviceTrust === "BLOCKED") {
    await securityLog(db, {
      userId: input.userId,
      eventType: "BLOCKED_DEVICE_COUNTRY_CHANGE_ATTEMPT",
      severity: "HIGH",
      metadata: { operation: input.operation }
    });
    const error: any = new Error("This device is blocked.");
    error.status = 403;
    error.code = "DEVICE_BLOCKED";
    throw error;
  }

  if (!input.stepUpSatisfied) {
    const error: any = new Error("Step-up verification required.");
    error.status = 401;
    error.code = "STEPUP_REQUIRED";
    throw error;
  }

  if (input.riskScore >= 80) {
    await securityLog(db, {
      userId: input.userId,
      eventType: "HIGH_RISK_COUNTRY_CHANGE_BLOCKED",
      severity: "HIGH",
      metadata: { operation: input.operation, riskScore: input.riskScore }
    });
    const error: any = new Error("Security review required.");
    error.status = 403;
    error.code = "SECURITY_REVIEW_REQUIRED";
    throw error;
  }

  return true;
}

import { describe, expect, it } from "vitest";
import { deriveFraudRiskLevel, hasActionableRiskEvidence } from "../services/operations/fraud-risk-evidence.service.js";
import { requiredScopeForRiskDecision } from "../services/operations/fraud-risk-review.service.js";
import { deriveRiskLevel } from "../services/operations/client360.service.js";
import { STAFF_ROLE_SCOPES } from "../auth/ops-scopes.js";

describe("operations: fraud & risk level", () => {
  it("escalates a suspended account to CRITICAL regardless of reports", () => {
    expect(deriveFraudRiskLevel([], "SUSPENDED")).toBe("CRITICAL");
  });

  it("takes the highest open severity for an active account", () => {
    expect(
      deriveFraudRiskLevel(
        [
          { severity: "MEDIUM", status: "OPEN" },
          { severity: "HIGH", status: "OPEN" }
        ],
        "ACTIVE"
      )
    ).toBe("HIGH");
  });

  it("ignores closed reports", () => {
    expect(deriveFraudRiskLevel([{ severity: "CRITICAL", status: "CLOSED" }], "ACTIVE")).toBe("LOW");
  });

  // The pack shipped a second, subtly different severity ladder. Locking the
  // agreement down so the Fraud & Risk panel and the Client 360 risk block
  // can never disagree about the same account.
  it("agrees with the Client 360 risk block for a non-suspended account", () => {
    const reports = [
      { severity: "LOW" as const, status: "OPEN" },
      { severity: "MEDIUM" as const, status: "INVESTIGATING" }
    ];
    expect(deriveFraudRiskLevel(reports, "ACTIVE")).toBe(deriveRiskLevel(reports));
  });
});

describe("operations: fraud & risk actionable evidence", () => {
  const none = {
    openSafetyReportCount: 0,
    highValueTransferCount: 0,
    unverifiedPaymentMethodCount: 0,
    userSuspended: false
  };

  it("is not actionable with nothing on screen", () => {
    expect(hasActionableRiskEvidence(none)).toBe(false);
  });

  it("is actionable on an open safety report alone", () => {
    expect(hasActionableRiskEvidence({ ...none, openSafetyReportCount: 1 })).toBe(true);
  });

  it("is actionable on a high-value transfer alone", () => {
    expect(hasActionableRiskEvidence({ ...none, highValueTransferCount: 1 })).toBe(true);
  });

  it("is actionable on an unverified payment method alone", () => {
    expect(hasActionableRiskEvidence({ ...none, unverifiedPaymentMethodCount: 1 })).toBe(true);
  });

  it("is actionable on suspension alone", () => {
    expect(hasActionableRiskEvidence({ ...none, userSuspended: true })).toBe(true);
  });
});

describe("operations: fraud & risk decision scope requirement", () => {
  it("requires ops:risk:approve only for APPROVED", () => {
    expect(requiredScopeForRiskDecision("APPROVED")).toBe("ops:risk:approve");
  });

  it("requires ops:risk:review for REJECTED and ESCALATED", () => {
    expect(requiredScopeForRiskDecision("REJECTED")).toBe("ops:risk:review");
    expect(requiredScopeForRiskDecision("ESCALATED")).toBe("ops:risk:review");
  });
});

describe("operations: fraud & risk role grants", () => {
  it("gives FRAUD_ANALYST the full risk review set", () => {
    expect(STAFF_ROLE_SCOPES.FRAUD_ANALYST).toEqual(
      expect.arrayContaining(["ops:risk:read", "ops:risk:review", "ops:risk:approve"])
    );
  });

  it("does not grant ops:risk:approve broadly", () => {
    expect(STAFF_ROLE_SCOPES.SUPERVISOR).not.toContain("ops:risk:approve");
    expect(STAFF_ROLE_SCOPES.SUPPORT_AGENT).not.toContain("ops:risk:approve");
    expect(STAFF_ROLE_SCOPES.SUPPORT_AGENT).not.toContain("ops:risk:review");
  });

  it("keeps per-transaction LinqaSend detail away from general agents", () => {
    expect(STAFF_ROLE_SCOPES.SUPPORT_AGENT).not.toContain("ops:linqasend:read");
  });

  // A specialist reaches a case only through "my work" / "assign to me" --
  // there is no read-only case-open path in the workspace UI.
  it("lets FRAUD_ANALYST actually reach a case", () => {
    expect(STAFF_ROLE_SCOPES.FRAUD_ANALYST).toEqual(
      expect.arrayContaining(["ops:case:read", "ops:case:assign", "ops:case:release"])
    );
  });
});

// The evidence-read path (safety_reports by reported_user_id, the
// linqasend_recipients join for received transfers, the
// linqasend_risk_assessments score rollup) and the review-write transaction
// need seeded rows across six tables -- same Postgres-fixture harness gap
// tracked in every other operations-*.test.ts file in this directory. Not
// mocked, to avoid a false sense of coverage.
describe.todo("operations: fraud & risk specialist review (needs Postgres fixture)", () => {
  it.todo("requires ops:risk:read to view evidence");
  it.todo("requires ops:risk:review to reject or escalate");
  it.todo("requires ops:risk:approve for APPROVED");
  it.todo("resolves user_id from support_cases_v2");
  it.todo("reads safety_reports by reported_user_id without mutating it");
  it.todo("reads linqasend_payment_methods excluding soft-deleted rows");
  it.todo("counts transfers sent by the user and received through linqasend_recipients.linqa_user_id");
  it.todo("flags high-value transfers at the same threshold as RiskEngineService");
  it.todo("reports the worst linqasend_risk_assessments score for the account");
  it.todo("persists evidence snapshot alongside the specialist decision");
  it.todo("writes ops_audit_events in the same transaction as the review upsert");
  it.todo("writes a support_case_events_v2 event via SupportOperationsService.addEvent()");
  it.todo("rejects review changes on CLOSED cases");
  it.todo("upserts on repeated decisions for the same case (ON CONFLICT case_id)");
  it.todo("does not suspend users, release holds, reverse transfers, or mutate payment methods");
});

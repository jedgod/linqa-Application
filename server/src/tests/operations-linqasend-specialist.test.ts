import { describe, expect, it } from "vitest";
import { deriveTransferAttention } from "../services/operations/linqasend-evidence.service.js";
import { requiredScopeForLinqaSendDecision } from "../services/operations/linqasend-review.service.js";
import { HIGH_VALUE_TRANSFER_MINOR } from "../services/linqasend/risk-engine.service.js";
import { STAFF_ROLE_SCOPES } from "../auth/ops-scopes.js";

const transfer = (over: Partial<Parameters<typeof deriveTransferAttention>[0]> = {}) => ({
  status: "COMPLETED",
  sendAmountMinor: 5_000n,
  paymentMethodVerified: true as boolean | null,
  ...over
});

describe("operations: LinqaSend transfer attention", () => {
  it("is NORMAL for a small completed transfer on a verified method", () => {
    expect(deriveTransferAttention(transfer())).toBe("NORMAL");
  });

  it("is HIGH for transfers that failed or were clawed back", () => {
    for (const status of ["FAILED", "REVERSED", "DECLINED", "DISPUTED", "CHARGEBACK"]) {
      expect(deriveTransferAttention(transfer({ status }))).toBe("HIGH");
    }
  });

  it("is REVIEW for the states the pipeline parks for a human", () => {
    for (const status of ["ON_HOLD", "MANUAL_REVIEW", "RISK_REVIEW", "REQUIRES_ACTION"]) {
      expect(deriveTransferAttention(transfer({ status }))).toBe("REVIEW");
    }
  });

  // The pack lumped cancellation in with failure. In this schema CANCELED and
  // EXPIRED are ordinary benign endings, and flagging every one of them would
  // bury the genuine signals.
  it("leaves benign endings alone", () => {
    expect(deriveTransferAttention(transfer({ status: "CANCELED" }))).toBe("NORMAL");
    expect(deriveTransferAttention(transfer({ status: "EXPIRED" }))).toBe("NORMAL");
  });

  it("is REVIEW for an unverified payment method", () => {
    expect(deriveTransferAttention(transfer({ paymentMethodVerified: false }))).toBe("REVIEW");
  });

  // On a received transfer the instrument belongs to the counterparty, so
  // verification is unknown rather than false, and must not raise attention
  // on its own.
  it("does not flag a transfer whose payment method is simply unknown", () => {
    expect(deriveTransferAttention(transfer({ paymentMethodVerified: null }))).toBe("NORMAL");
  });

  it("is REVIEW at the repo's existing high-value threshold", () => {
    expect(deriveTransferAttention(transfer({ sendAmountMinor: HIGH_VALUE_TRANSFER_MINOR }))).toBe("REVIEW");
    expect(deriveTransferAttention(transfer({ sendAmountMinor: HIGH_VALUE_TRANSFER_MINOR - 1n }))).toBe("NORMAL");
  });

  it("prefers the failure signal over the amount signal", () => {
    expect(deriveTransferAttention(transfer({ status: "FAILED", sendAmountMinor: HIGH_VALUE_TRANSFER_MINOR }))).toBe("HIGH");
  });
});

describe("operations: LinqaSend decision scope requirement", () => {
  it("requires ops:linqasend:approve only for APPROVED", () => {
    expect(requiredScopeForLinqaSendDecision("APPROVED")).toBe("ops:linqasend:approve");
  });

  it("requires ops:linqasend:review for REJECTED and ESCALATED", () => {
    expect(requiredScopeForLinqaSendDecision("REJECTED")).toBe("ops:linqasend:review");
    expect(requiredScopeForLinqaSendDecision("ESCALATED")).toBe("ops:linqasend:review");
  });
});

describe("operations: LinqaSend role grants", () => {
  it("gives FINANCE_OPS the full LinqaSend review set", () => {
    expect(STAFF_ROLE_SCOPES.FINANCE_OPS).toEqual(
      expect.arrayContaining(["ops:linqasend:read", "ops:linqasend:review", "ops:linqasend:approve"])
    );
  });

  it("does not grant ops:linqasend:approve broadly", () => {
    expect(STAFF_ROLE_SCOPES.SUPERVISOR).not.toContain("ops:linqasend:approve");
    expect(STAFF_ROLE_SCOPES.FRAUD_ANALYST).not.toContain("ops:linqasend:approve");
  });

  it("lets FINANCE_OPS actually reach a case", () => {
    expect(STAFF_ROLE_SCOPES.FINANCE_OPS).toEqual(
      expect.arrayContaining(["ops:case:read", "ops:case:assign", "ops:case:release"])
    );
  });
});

// The evidence-read path (soft-delete filtering, the linqasend_recipients
// join, payment-method verification lookup per transfer) and the review-write
// transaction need seeded rows across five tables -- same Postgres-fixture
// harness gap tracked in every other operations-*.test.ts file here.
describe.todo("operations: LinqaSend specialist review (needs Postgres fixture)", () => {
  it.todo("requires ops:linqasend:read to view evidence");
  it.todo("requires ops:linqasend:review to reject or escalate");
  it.todo("requires ops:linqasend:approve for APPROVED");
  it.todo("reads payment methods excluding soft-deleted rows");
  it.todo("masks the instrument reference to last4 only");
  it.todo("labels direction SENT vs RECEIVED via linqasend_recipients.linqa_user_id");
  it.todo("resolves paymentMethodVerified only for the sender's own instruments");
  it.todo("persists evidence snapshot alongside the specialist decision");
  it.todo("captures the previous decision in ops_audit_events.before_json on re-review");
  it.todo("writes ops_audit_events in the same transaction as the review upsert");
  it.todo("writes a support_case_events_v2 event via SupportOperationsService.addEvent()");
  it.todo("rejects review changes on CLOSED cases");
  it.todo("does not release holds, reverse or cancel transfers, refund, or mutate payment methods");
});

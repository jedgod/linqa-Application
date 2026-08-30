import { describe, expect, it } from "vitest";
import { hasStrongEvidence } from "../services/operations/recovery-evidence.service.js";
import { requiredScopeForDecision, canReviewCase } from "../services/operations/recovery-review.service.js";

describe("operations: recovery evidence strength", () => {
  it("is not strong with no evidence at all", () => {
    expect(hasStrongEvidence({ verifiedRecoveryEmailCount: 0, trustedDeviceCount: 0, activePasskeyCount: 0 })).toBe(false);
  });

  it("is strong with a verified recovery email alone", () => {
    expect(hasStrongEvidence({ verifiedRecoveryEmailCount: 1, trustedDeviceCount: 0, activePasskeyCount: 0 })).toBe(true);
  });

  it("is strong with a trusted device alone", () => {
    expect(hasStrongEvidence({ verifiedRecoveryEmailCount: 0, trustedDeviceCount: 1, activePasskeyCount: 0 })).toBe(true);
  });

  it("is strong with an active passkey alone", () => {
    expect(hasStrongEvidence({ verifiedRecoveryEmailCount: 0, trustedDeviceCount: 0, activePasskeyCount: 1 })).toBe(true);
  });
});

describe("operations: recovery decision scope requirement", () => {
  it("requires ops:recovery:approve only for APPROVED", () => {
    expect(requiredScopeForDecision("APPROVED")).toBe("ops:recovery:approve");
  });

  it("requires ops:recovery:review for REJECTED and ESCALATED", () => {
    expect(requiredScopeForDecision("REJECTED")).toBe("ops:recovery:review");
    expect(requiredScopeForDecision("ESCALATED")).toBe("ops:recovery:review");
  });
});

describe("operations: recovery review case eligibility", () => {
  it("allows review on any state except CLOSED", () => {
    expect(canReviewCase("OPEN")).toBe(true);
    expect(canReviewCase("WAITING_USER")).toBe(true);
    expect(canReviewCase("WAITING_INTERNAL")).toBe(true);
    expect(canReviewCase("RESOLVED")).toBe(true);
  });

  it("rejects review on a CLOSED case", () => {
    expect(canReviewCase("CLOSED")).toBe(false);
  });
});

// The evidence-read path (recovery_email_identities_v3 /
// trusted_installation_devices_v3 / webauthn_credentials joins) and the
// review-write transaction need seeded rows across five tables -- same
// Postgres-fixture harness gap tracked in every other operations-*.test.ts
// file in this directory. Not mocked, to avoid a false sense of coverage.
describe.todo("operations: recovery specialist review (needs Postgres fixture)", () => {
  it.todo("requires ops:recovery:read to view evidence");
  it.todo("requires ops:recovery:review to reject or escalate");
  it.todo("requires ops:recovery:approve for APPROVED");
  it.todo("resolves user_id from support_cases_v2");
  it.todo("reads recovery_email_identities_v3 without mutating it");
  it.todo("reads trusted_installation_devices_v3 (joined through device_installations_v2 and devices) without mutating it");
  it.todo("reads webauthn_credentials without mutating it");
  it.todo("persists evidence snapshot alongside the specialist decision");
  it.todo("writes ops_audit_events in the same transaction as the review upsert");
  it.todo("writes a support_case_events_v2 event for the specialist decision via SupportOperationsService.addEvent()");
  it.todo("rejects review changes on CLOSED cases");
  it.todo("upserts on repeated decisions for the same case (ON CONFLICT case_id)");
  it.todo("does not reset 2FA, delete passkeys, change recovery email, or mutate trusted devices");
});

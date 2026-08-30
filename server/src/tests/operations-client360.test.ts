import { describe, expect, it } from "vitest";
import { deriveRiskLevel, maskEmail, maskPhone } from "../services/operations/client360.service.js";

describe("operations: Client 360 risk level derivation", () => {
  it("returns LOW with no reports", () => {
    expect(deriveRiskLevel([])).toBe("LOW");
  });

  it("returns LOW if every report is CLOSED, regardless of severity", () => {
    expect(deriveRiskLevel([{ status: "CLOSED", severity: "CRITICAL" }])).toBe("LOW");
  });

  it("returns MEDIUM for any open report below HIGH severity", () => {
    expect(deriveRiskLevel([{ status: "OPEN", severity: "LOW" }])).toBe("MEDIUM");
    expect(deriveRiskLevel([{ status: "TRIAGED", severity: "MEDIUM" }])).toBe("MEDIUM");
  });

  it("returns HIGH if any open report is HIGH severity, even alongside lower-severity ones", () => {
    expect(deriveRiskLevel([{ status: "OPEN", severity: "LOW" }, { status: "INVESTIGATING", severity: "HIGH" }])).toBe("HIGH");
  });

  it("returns CRITICAL if any open report is CRITICAL, even alongside HIGH", () => {
    expect(deriveRiskLevel([{ status: "ACTIONED", severity: "HIGH" }, { status: "OPEN", severity: "CRITICAL" }])).toBe("CRITICAL");
  });
});

describe("operations: Client 360 identifier masking", () => {
  it("keeps the first character and the full domain of an email", () => {
    expect(maskEmail("jerry@example.com")).toBe("j****@example.com");
  });

  it("falls back to *** for a value with no @ in it", () => {
    expect(maskEmail("not-an-email")).toBe("***");
  });

  it("keeps only the last 4 digits of a phone number", () => {
    expect(maskPhone("+1 (240) 555-5478")).toBe("***5478");
  });

  it("falls back to *** for fewer than 4 digits", () => {
    expect(maskPhone("12")).toBe("***");
  });
});

// The per-domain SQL (devices/linqaSend/vault/recovery/identity) needs
// seeded rows across six tables, which belongs in the same Postgres-fixture
// harness gap already tracked in operations.test.ts and
// operations-customer-reply.test.ts -- not mocked, to avoid a false sense
// of coverage.
describe.todo("operations: Client 360 enrichment (needs Postgres fixture)", () => {
  it.todo("requires ops:client360:read");
  it.todo("404s when the case doesn't exist");
  it.todo("returns nulls with availability:false for a case with no linked user");
  it.todo("derives devices.activeDeviceCount from last_seen_at within 30 days");
  it.todo("derives risk.safetyRestrictionActive from users.status = SUSPENDED");
  it.todo("returns a partial projection (per-domain availability:false) if one domain query throws");
  it.todo("never includes password hashes, key material, OTP secrets, or full identifiers");
});

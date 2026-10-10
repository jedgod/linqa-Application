import { describe, expect, it } from "vitest";
import type { Database } from "../db/pool.js";
import { canonicalJson, snapshotSha256, type RegulatedEntityResolution } from "../services/linqasend/regulatory-v7.js";
import { ResponsibilityError, ResponsibilityExecutionGuard } from "../services/linqasend/v7-execution-guard.js";
import { createTransferSchema, linqaSendAvailability } from "../routes/linqasend/routes.js";

const ids = { quote: "11111111-1111-4111-8111-111111111111", method: "22222222-2222-4222-8222-222222222222", auth: "33333333-3333-4333-8333-333333333333" };
const validBody = { quoteId: ids.quote, paymentMethodId: ids.method, securityAuthorizationId: ids.auth, transactionHash: "a".repeat(64) };

describe("create-transfer request is strict (tests H)", () => {
  it("accepts the documented fields", () => {
    expect(createTransferSchema.safeParse(validBody).success).toBe(true);
  });
  it.each([
    "regulatedEntityId", "fundingProviderId", "payoutProviderId", "fxProviderId", "settlementProviderId", "providerId",
    "contractId", "responsibilityMapId", "legalApprovalReference", "partnerApprovalReference", "custodyModel", "realMoneyReady"
  ])("rejects a client-supplied %s", (field) => {
    expect(createTransferSchema.safeParse({ ...validBody, [field]: "x" }).success).toBe(false);
  });
});

describe("responsibility snapshot hash", () => {
  const resolution = (override: Partial<RegulatedEntityResolution> = {}): RegulatedEntityResolution => ({
    responsibilityMapId: "map-1", policyVersion: 3, sourceCountry: "US", destinationCountry: "GH", transferClass: "EXTERNAL_CROSS_BORDER",
    custodyModel: "FBO_OR_EQUIVALENT_PARTNER_ACCOUNT", legalApprovalReference: "LEGAL-1", partnerApprovalReference: "PARTNER-1", effectiveAt: "2026-10-06T00:00:00.000Z",
    complete: true, missingResponsibilities: [], blockedReasons: [],
    authorities: [{ responsibility: "BANK_DEBIT", providerAdapterKey: "acme", entityId: "e1", legalName: "Acme Bank", entityType: "BANK", countryCode: "US", contractId: "c1", contractStatus: "ACTIVE", operationalStatus: "HEALTHY" }],
    ...override
  });

  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("covers the nested authorities (the old replacer-array hash did not)", () => {
    const base = snapshotSha256(resolution());
    const swapped = resolution({ authorities: [{ ...resolution().authorities[0]!, entityId: "someone-else" }] });
    expect(snapshotSha256(swapped)).not.toBe(base);
    const otherAdapter = resolution({ authorities: [{ ...resolution().authorities[0]!, providerAdapterKey: "other" }] });
    expect(snapshotSha256(otherAdapter)).not.toBe(base);
  });
  it("is stable for identical content", () => {
    expect(snapshotSha256(resolution())).toBe(snapshotSha256(JSON.parse(JSON.stringify(resolution()))));
  });
});

/** Answers the guard's two query shapes from fixtures, so the test exercises the guard's decisions, not SQL. */
function fakeDb(fixture: {
  transfer?: Record<string, unknown> | null;
  map?: Record<string, unknown> | null;
  entity?: Record<string, unknown> | null;
  contract?: Record<string, unknown> | null;
}) {
  const calls: string[] = [];
  const db = {
    query: async (sql: string) => {
      calls.push(sql.slice(0, 60));
      if (sql.includes("FROM linqasend_transfers t")) return { rows: fixture.transfer ? [fixture.transfer] : [] };
      if (sql.includes("linqasend_financial_responsibility_maps_v7")) return { rows: fixture.map ? [fixture.map] : [] };
      if (sql.includes("linqasend_financial_entities_v7")) return { rows: fixture.entity ? [fixture.entity] : [] };
      if (sql.includes("linqasend_partner_contracts_v7")) return { rows: fixture.contract ? [fixture.contract] : [] };
      return { rows: [] };
    }
  } as unknown as Database;
  return { db, calls };
}

const transfer = {
  responsibility_snapshot_id: "snap-1", transfer_class: "INTERNAL_DOMESTIC", funding_mode: "BANK", receive_mode: "BANK",
  source_country: "US", destination_country: "US", send_currency: "USD", receive_currency: "USD",
  responsibility_map_id: "map-1", policy_version: 2, complete: true, snapshot_hash: "h".repeat(64)
};
/** Every REQUIRED responsibility for a domestic USD bank->bank NO_CUSTOMER_FUNDS transfer points at one entity. */
const everyResponsibility = ["CUSTOMER_ONBOARDING", "KYC_CIP", "AML_MONITORING", "SANCTIONS_SCREENING", "ACCEPT_CUSTOMER_FUNDS", "DOMESTIC_TRANSMISSION", "BANK_DEBIT", "LOCAL_BANK_PAYOUT", "DISPUTES", "REFUNDS", "SETTLEMENT", "RECONCILIATION", "CHARGEBACKS", "CUSTOMER_ACCOUNT_ISSUER"];
const map = { id: "map-1", policy_version: 2, custody_model: "NO_CUSTOMER_FUNDS", legal_approval_reference: "LEGAL", partner_approval_reference: "PARTNER", responsibility_entities: Object.fromEntries(everyResponsibility.map((r) => [r, "ent-1"])) };
const entity = { id: "ent-1", legal_name: "Acme Bank", entity_type: "BANK", country_code: "US", status: "ACTIVE", due_diligence_status: "APPROVED", current_operational_status: "HEALTHY", regulatory_reference: "REG" };
const contract = { id: "con-1", status: "ACTIVE", provider_adapter_key: "acme" };
const ready = { transfer, map, entity, contract };

describe("execution guard in front of every provider call (tests J-L, A-E, G)", () => {
  it("authorizes a complete map whose contracts name the provider", async () => {
    const { db } = fakeDb(ready);
    const result = await new ResponsibilityExecutionGuard(db).authorize("t1", "acme");
    expect(result.snapshotId).toBe("snap-1");
    expect(result.snapshotSha256).toBe("h".repeat(64));
  });

  it("requires the persisted snapshot", async () => {
    for (const row of [null, { ...transfer, responsibility_snapshot_id: null }, { ...transfer, snapshot_hash: null }]) {
      await expect(new ResponsibilityExecutionGuard(fakeDb({ ...ready, transfer: row }).db).authorize("t1", "acme"))
        .rejects.toMatchObject({ code: "REGULATED_RESPONSIBILITY_SNAPSHOT_REQUIRED" });
    }
  });

  it("refuses an incomplete snapshot", async () => {
    await expect(new ResponsibilityExecutionGuard(fakeDb({ ...ready, transfer: { ...transfer, complete: false } }).db).authorize("t1", "acme"))
      .rejects.toMatchObject({ code: "REAL_MONEY_NOT_READY" });
  });

  it.each([
    ["no map", { map: null }],
    ["inactive partner", { entity: { ...entity, status: "SUSPENDED" } }],
    ["due diligence not approved", { entity: { ...entity, due_diligence_status: "PENDING" } }],
    ["no effective contract (missing or expired)", { contract: null }],
    ["partner DOWN", { entity: { ...entity, current_operational_status: "DOWN" } }],
    ["partner UNKNOWN", { entity: { ...entity, current_operational_status: "UNKNOWN" } }]
  ])("revalidates at execution and blocks: %s", async (_name, change) => {
    await expect(new ResponsibilityExecutionGuard(fakeDb({ ...ready, ...change }).db).authorize("t1", "acme"))
      .rejects.toMatchObject({ code: "REAL_MONEY_NOT_READY" });
  });

  it("blocks a missing authority for a required responsibility (bank payout)", async () => {
    const entities = { ...map.responsibility_entities } as Record<string, string>;
    delete entities.LOCAL_BANK_PAYOUT;
    await expect(new ResponsibilityExecutionGuard(fakeDb({ ...ready, map: { ...map, responsibility_entities: entities } }).db).authorize("t1", "acme"))
      .rejects.toMatchObject({ code: "REAL_MONEY_NOT_READY" });
  });

  it("refuses when the governing map or version changed after the snapshot", async () => {
    await expect(new ResponsibilityExecutionGuard(fakeDb({ ...ready, map: { ...map, id: "map-2" } }).db).authorize("t1", "acme"))
      .rejects.toMatchObject({ code: "RESPONSIBILITY_MAP_CHANGED" });
    await expect(new ResponsibilityExecutionGuard(fakeDb({ ...ready, map: { ...map, policy_version: 3 } }).db).authorize("t1", "acme"))
      .rejects.toMatchObject({ code: "RESPONSIBILITY_MAP_CHANGED" });
  });

  it("routes only through the adapter the approved contract names", async () => {
    await expect(new ResponsibilityExecutionGuard(fakeDb(ready).db).authorize("t1", "some-other-provider"))
      .rejects.toMatchObject({ code: "REGULATED_PROVIDER_NOT_AUTHORIZED" });
    await expect(new ResponsibilityExecutionGuard(fakeDb({ ...ready, contract: { ...contract, provider_adapter_key: null } }).db).authorize("t1", "acme"))
      .rejects.toMatchObject({ code: "REGULATED_PROVIDER_NOT_AUTHORIZED" });
  });

  it("errors carry a stable code and no provider credentials", () => {
    const error = new ResponsibilityError("REGULATED_PROVIDER_NOT_AUTHORIZED", "BANK_DEBIT:acme");
    expect(error.code).toBe("REGULATED_PROVIDER_NOT_AUTHORIZED");
    expect(error.message).toBe("REGULATED_PROVIDER_NOT_AUTHORIZED:BANK_DEBIT:acme");
  });
});

describe("LinqaSend availability", () => {
  it("is visible outside production, and in production only when real money is enabled", () => {
    expect(linqaSendAvailability({ NODE_ENV: "development" })).toMatchObject({ available: true, realMoneyEnabled: false });
    expect(linqaSendAvailability({ NODE_ENV: "test" }).available).toBe(true);
    expect(linqaSendAvailability({ NODE_ENV: "production" }).available).toBe(false);
    expect(linqaSendAvailability({ NODE_ENV: "production", LINQASEND_REAL_MONEY_ENABLED: true })).toMatchObject({ available: true, realMoneyEnabled: true });
  });
});

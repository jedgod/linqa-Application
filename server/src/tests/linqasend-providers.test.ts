import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SafeDefaultFundingProvider,
  SafeDefaultKycProvider,
  SafeDefaultPayoutProvider,
  safeDefaultLinqaSendProviders
} from "../integrations/linqasend/safe-default.providers.js";
import { getLinqaSendProviders, configureLinqaSendProviders, resetLinqaSendProvidersToSafeDefaults } from "../integrations/linqasend/provider.registry.js";
import { verifyLinqaSendWebhookSignature } from "../integrations/linqasend/webhook-verifier.js";
import { reconcileInFlightTransfers } from "../integrations/linqasend/reconciliation.js";
import type { Database } from "../db/pool.js";
import type { FundingProvider, KycProvider, PayoutProvider } from "../integrations/linqasend/provider.contracts.js";
import { createHmac } from "node:crypto";
import { createHttpLinqaSendProviders } from "../integrations/linqasend/http.providers.js";

afterEach(() => vi.unstubAllGlobals());

describe("LinqaSend HTTP provider gateway", () => {
  it("authenticates requests, serializes bigint amounts, and validates responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ decision: "PASS", reasons: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "AUTHORIZED", providerRef: "fund-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const providers = createHttpLinqaSendProviders("https://provider.test/", "provider-token-at-least-16");

    await expect(providers.kyc.verifyIdentity({ legalName: "Alex", country: "US" })).resolves.toEqual({ decision: "PASS", reasons: [] });
    await expect(providers.funding.authorizeFunding({ transferId: "t1", providerPaymentMethodRef: "pm1", amountMinor: 1250n, currency: "USD", idempotencyKey: "idem-1" })).resolves.toMatchObject({ status: "AUTHORIZED" });

    expect(fetchMock.mock.calls[0]![1]!.headers.authorization).toBe("Bearer provider-token-at-least-16");
    expect(fetchMock.mock.calls[1]![1]!.body).toContain('"amountMinor":"1250"');
  });
});

describe("LinqaSend safe-default providers", () => {
  it("KYC fails closed to REVIEW rather than PASS or throwing", async () => {
    const kyc: KycProvider = new SafeDefaultKycProvider();
    const result = await kyc.verifyIdentity({ legalName: "A", country: "US" });
    expect(result.decision).toBe("REVIEW");
  });

  it("funding provider declines and reports null on reconciliation lookup", async () => {
    const provider: FundingProvider = new SafeDefaultFundingProvider();
    const authorization = await provider.authorizeFunding({
      transferId: "t1",
      providerPaymentMethodRef: "pm1",
      amountMinor: 100n,
      currency: "USD",
      idempotencyKey: "key1"
    });
    expect(authorization.status).toBe("DECLINED");
    await expect(provider.lookupByIdempotencyKey("key1")).resolves.toBeNull();
  });

  it("payout provider throws (fail closed) and reports null on lookup", async () => {
    const provider: PayoutProvider = new SafeDefaultPayoutProvider();
    await expect(
      provider.createPayout({
        transferId: "t1",
        recipientProviderRef: "r1",
        amountMinor: 100n,
        currency: "USD",
        idempotencyKey: "key1"
      })
    ).rejects.toThrow();
    await expect(provider.lookup("ref1")).resolves.toBeNull();
  });

  it("safeDefaultLinqaSendProviders wires all five roles", () => {
    const providers = safeDefaultLinqaSendProviders();
    expect(providers.kyc).toBeDefined();
    expect(providers.compliance).toBeDefined();
    expect(providers.funding).toBeDefined();
    expect(providers.payout).toBeDefined();
    expect(providers.fx).toBeDefined();
  });
});

describe("LinqaSend provider registry", () => {
  it("returns safe defaults until explicitly configured, and can be reset", () => {
    resetLinqaSendProvidersToSafeDefaults();
    const before = getLinqaSendProviders();
    expect(before.kyc.name).toBe("unconfigured");

    const fakeKyc = { name: "fake", verifyIdentity: async () => ({ decision: "PASS" as const, reasons: [] }) };
    configureLinqaSendProviders({ kyc: fakeKyc });
    expect(getLinqaSendProviders().kyc.name).toBe("fake");

    resetLinqaSendProvidersToSafeDefaults();
    expect(getLinqaSendProviders().kyc.name).toBe("unconfigured");
  });
});

describe("LinqaSend webhook signature verification", () => {
  it("fails closed when no secret is configured", () => {
    const result = verifyLinqaSendWebhookSignature({
      secret: undefined,
      rawBody: Buffer.from("{}"),
      signatureHeader: "t=123,v1=abc"
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("webhook_secret_not_configured");
  });

  it("accepts a correctly-signed, fresh payload and rejects a tampered one", () => {
    const secret = "a".repeat(32);
    const rawBody = Buffer.from(JSON.stringify({ event: "payout.completed" }));
    const timestamp = Math.floor(Date.now() / 1000);
    const mac = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
    const header = `t=${timestamp},v1=${mac}`;

    expect(verifyLinqaSendWebhookSignature({ secret, rawBody, signatureHeader: header }).valid).toBe(true);

    const tamperedBody = Buffer.from(JSON.stringify({ event: "payout.failed" }));
    expect(verifyLinqaSendWebhookSignature({ secret, rawBody: tamperedBody, signatureHeader: header }).valid).toBe(false);
  });

  it("rejects a stale timestamp outside tolerance", () => {
    const secret = "a".repeat(32);
    const rawBody = Buffer.from("{}");
    const oldTimestamp = Math.floor(Date.now() / 1000) - 10_000;
    const mac = createHmac("sha256", secret).update(`${oldTimestamp}.`).update(rawBody).digest("hex");
    const result = verifyLinqaSendWebhookSignature({
      secret,
      rawBody,
      signatureHeader: `t=${oldTimestamp},v1=${mac}`,
      toleranceSeconds: 300
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_timestamp_outside_tolerance");
  });
});

describe("LinqaSend reconciliation", () => {
  it("reports zero mismatches against the safe-default providers (nothing to find)", async () => {
    const query = async (sql: string) => {
      if (sql.includes("FROM linqasend_transfers")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected query: ${sql}`);
    };
    const result = await reconcileInFlightTransfers({ query } as unknown as Database, safeDefaultLinqaSendProviders());
    expect(result.checked).toBe(0);
    expect(result.mismatches).toEqual([]);
  });
});

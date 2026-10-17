import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { DevLocalKmsProvider, devSandboxCardProvider } from "../services/linqasend/dev-sandbox.js";
// @ts-expect-error plain .mjs script without types
import { createCardProvider } from "../../../scripts/dev-sandbox-card-provider.mjs";

const base = { NODE_ENV: "development", DATABASE_URL: "postgresql://unused", JWT_ISSUER: "https://test.linqa.local", JWT_AUDIENCE: "test", JWT_HS256_SECRET: "x".repeat(32), CONTACT_DISCOVERY_SECRET: "c".repeat(32), TOKEN_VAULT_KEY_BASE64: "A".repeat(44), TURN_SHARED_SECRET: "t".repeat(32) };
const sandbox = { LINQASEND_DEV_SANDBOX: "true", LINQASEND_DEV_CARD_PROVIDER_URL: "http://127.0.0.1:8099", LINQASEND_DEV_CARD_PROVIDER_TOKEN: "dev-provider-token-1234" };

describe("LinqaSend development card sandbox gating", () => {
  it("is inert unless explicitly enabled", () => {
    expect(devSandboxCardProvider(loadConfig({ ...base } as never))).toBeNull();
  });
  it("activates only in development with real money off", () => {
    expect(devSandboxCardProvider(loadConfig({ ...base, ...sandbox } as never))).not.toBeNull();
  });
  it.each([
    ["production", { NODE_ENV: "production" }],
    ["test environment", { NODE_ENV: "test" }],
    ["real money enabled", { LINQASEND_REAL_MONEY_ENABLED: "true", LINQASEND_MODE: "LIMITED_LAUNCH" }],
    ["non-sandbox mode", { LINQASEND_MODE: "LIMITED_LAUNCH" }],
    ["KMS configured", { LINQASEND_TOKEN_KMS_KEY_ID: "k", LINQASEND_TOKEN_KMS_REGION: "us-east-1" }],
    ["remote provider URL", { LINQASEND_DEV_CARD_PROVIDER_URL: "https://cards.example.com" }],
    ["missing provider token", { LINQASEND_DEV_CARD_PROVIDER_TOKEN: undefined }]
  ])("refuses to load with %s", (_name, override) => {
    expect(() => loadConfig({ ...base, ...sandbox, ...override } as never)).toThrow();
  });
});

describe("DevLocalKmsProvider", () => {
  it("round-trips a data key and rejects a different context", async () => {
    const kms = new DevLocalKmsProvider("s".repeat(32));
    const context = { linqasend_secret_id: "a", provider_id: "dev-sandbox", secret_kind: "FUNDING_METHOD" };
    const key = await kms.generateDataKey({ context });
    expect((await kms.decrypt({ ciphertext: key.ciphertext, context })).equals(key.plaintext)).toBe(true);
    await expect(kms.decrypt({ ciphertext: key.ciphertext, context: { ...context, provider_id: "other" } })).rejects.toThrow();
  });
});

describe("development card provider", () => {
  async function start() {
    const token = "dev-provider-token-1234";
    const server = createCardProvider({ token, baseUrl: "http://127.0.0.1:0" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (path: string, bearer: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { server, token, call };
  }

  it("keeps only brand, last four and expiry; never echoes the number or security code", async () => {
    const { server, token, call } = await start();
    try {
      const setup = await (await call("/payment-methods/setup", token, { userId: "u1", type: "CREDIT_CARD", billingCountry: "US" })).json();
      const endpoint = new URL(setup.cardEndpoint).pathname;
      const stored = await call(endpoint, setup.clientSecret, { number: "4242424242424242", expMonth: 3, expYear: 2099, cvv: "123" });
      expect(stored.status).toBe(204);
      const confirmed = await (await call("/payment-methods/confirm", token, { userId: "u1", setupToken: setup.setupToken })).json();
      expect(confirmed).toMatchObject({ provider: "dev-sandbox", type: "CREDIT_CARD", last4: "4242", brand: "VISA", verificationStatus: "VERIFIED", expYear: 2099 });
      const text = JSON.stringify(confirmed);
      expect(text).not.toContain("4242424242424242");
      expect(text).not.toContain("123\"");
    } finally { server.close(); }
  });

  it("rejects bad cards, wrong secrets, other users and replayed confirmations", async () => {
    const { server, token, call } = await start();
    try {
      const setup = await (await call("/payment-methods/setup", token, { userId: "u1", type: "DEBIT_CARD" })).json();
      const endpoint = new URL(setup.cardEndpoint).pathname;
      expect((await call(endpoint, "wrong-secret", { number: "4242424242424242", expMonth: 3, expYear: 2099, cvv: "123" })).status).toBe(401);
      expect((await call(endpoint, setup.clientSecret, { number: "4242424242424241", expMonth: 3, expYear: 2099, cvv: "123" })).status).toBe(422);
      expect((await call("/payment-methods/confirm", token, { userId: "u1", setupToken: setup.setupToken })).status).toBe(409);
      await call(endpoint, setup.clientSecret, { number: "4242424242424242", expMonth: 3, expYear: 2099, cvv: "123" });
      expect((await call("/payment-methods/confirm", token, { userId: "u2", setupToken: setup.setupToken })).status).toBe(409);
      expect((await call("/payment-methods/confirm", token, { userId: "u1", setupToken: setup.setupToken })).status).toBe(200);
      expect((await call("/payment-methods/confirm", token, { userId: "u1", setupToken: setup.setupToken })).status).toBe(409);
      expect((await call("/payment-methods/setup", "nope", { userId: "u1", type: "DEBIT_CARD" })).status).toBe(401);
    } finally { server.close(); }
  });
});

describe("development sandbox KYC marker", () => {
  it("is accepted only while the sandbox is active and never looks VERIFIED", async () => {
    const { acceptedKycStatuses, effectiveKycStatus, DEV_SANDBOX_KYC_STATUS } = await import("../services/linqasend/dev-sandbox.js");
    expect(DEV_SANDBOX_KYC_STATUS).not.toBe("VERIFIED");
    expect(acceptedKycStatuses(false)).toEqual(["VERIFIED"]);
    expect(acceptedKycStatuses(true)).toContain(DEV_SANDBOX_KYC_STATUS);
    expect(effectiveKycStatus(DEV_SANDBOX_KYC_STATUS)).toBe("VERIFIED");
    expect(effectiveKycStatus("PENDING")).toBe("PENDING");
  });
});

describe("development sandbox simulated providers", () => {
  it("excuses only configuration blockers, never certification, liquidity or sanctions", async () => {
    const { DEV_SANDBOX_EXCUSABLE_BLOCKERS } = await import("../services/linqasend/dev-sandbox.js");
    for (const kept of ["PROVIDER_NOT_CERTIFIED:x", "CORRIDOR_EXACT_SHA_CERTIFICATION_REQUIRED", "LIQUIDITY_BLOCKED", "CAPABILITY_DENIED", "DEPLOYED_ARTIFACT_NOT_APPROVED"]) expect(DEV_SANDBOX_EXCUSABLE_BLOCKERS.has(kept)).toBe(false);
    expect(DEV_SANDBOX_EXCUSABLE_BLOCKERS.has("REAL_MONEY_DISABLED")).toBe(true);
  });
  it("simulates USD within the sandbox limit and declines everything else without network access", async () => {
    const { createDevSandboxProviders } = await import("../services/linqasend/dev-sandbox.js");
    const p = createDevSandboxProviders();
    const base = { transferId: "11111111-2222-3333-4444-555555555555", providerPaymentMethodRef: "vault:x", idempotencyKey: "k-1" };
    expect((await p.funding.authorizeFunding({ ...base, amountMinor: 55079n, currency: "USD" })).status).toBe("AUTHORIZED");
    expect((await p.funding.authorizeFunding({ ...base, idempotencyKey: "k-2", amountMinor: 500_001n, currency: "USD" })).status).toBe("DECLINED");
    expect((await p.funding.authorizeFunding({ ...base, idempotencyKey: "k-3", amountMinor: 100n, currency: "EUR" })).status).toBe("DECLINED");
    expect(await p.funding.lookupByIdempotencyKey("k-1")).toMatchObject({ status: "AUTHORIZED" });
    const payout = await p.payout.createPayout({ transferId: base.transferId, recipientProviderRef: "r", amountMinor: 55079n, currency: "USD", idempotencyKey: "k-1" });
    expect(payout.status).toBe("COMPLETED");
    expect(await p.payout.lookup(payout.providerRef)).toEqual(payout);
    await expect(p.payout.createPayout({ transferId: base.transferId, recipientProviderRef: "r", amountMinor: 1n, currency: "GHS", idempotencyKey: "k" })).rejects.toThrow();
    await expect(p.fx.fetchFxRate({ baseCurrency: "USD", quoteCurrency: "GHS" })).rejects.toThrow();
  });
});

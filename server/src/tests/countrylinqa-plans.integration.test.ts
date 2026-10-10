import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../db/pool.js";
import { CountryLinqaPlans, PlanError, planFeatures, unconfiguredPlanPayments, type PaymentMethod, type PlanPaymentProvider } from "../services/countrylinqa/plans.js";

describe("plan features", () => {
  it("lists only what the app really gates by plan", () => {
    expect(planFeatures("PREMIUM", 20)).toEqual(["Up to 20 countries", "Discover by region", "Choose which countries can chat you"]);
    expect(planFeatures("ELITE", 20)[0]).toBe("Worldwide discovery");
    expect(planFeatures("FREE", 20)).toEqual(["Discover people in your own country"]);
  });
});

const url = process.env.DATABASE_URL;
const required = process.env.LINQA_REQUIRE_DB_TESTS === "1";
const run = url || required ? describe : describe.skip;

run("CountryLinqa plans and payments against the database", () => {
  const pool = new pg.Pool({ connectionString: url });
  const db = pool as unknown as Database;
  const users: string[] = [];
  const config = { COUNTRY_SELECTION_PREMIUM_LIMIT: 20 };
  const calls: Array<{ planCode: string; amountMinor: number; method: PaymentMethod }> = [];
  const provider: PlanPaymentProvider = {
    name: "test-pay",
    methods: () => ["CARD", "PAYPAL"],
    createCheckout: async (i) => { calls.push({ planCode: i.planCode, amountMinor: i.amountMinor, method: i.method }); return { sessionRef: `sess_${i.idempotencyKey}`, checkoutUrl: `https://pay.test/${i.idempotencyKey}` }; }
  };
  const plans = new CountryLinqaPlans(db, config, provider);

  async function makeUser() {
    const id = randomUUID();
    await pool.query("INSERT INTO users (id, external_subject, status) VALUES ($1,$2,'ACTIVE')", [id, `plans-${id}`]);
    users.push(id);
    return id;
  }
  const key = () => `key-${randomUUID()}`;
  const setPlan = (userId: string, plan: string, status = "ACTIVE") =>
    pool.query("INSERT INTO subscription_accounts (user_id, provider, status, plan_code) VALUES ($1,'STRIPE',$2,$3) ON CONFLICT (user_id) DO UPDATE SET status=$2, plan_code=$3", [userId, status, plan]);

  afterAll(async () => {
    if (users.length) await pool.query("DELETE FROM users WHERE id = ANY($1)", [users]);
    await pool.end();
  });

  it("lists Free, Premium and Elite with server-side prices and what each unlocks", async () => {
    const user = await makeUser();
    const list = await plans.list(user);
    expect(list.plans.map((p) => [p.code, p.monthlyPriceMinor])).toEqual([["FREE", 0], ["PREMIUM", 499], ["ELITE", 999]]);
    expect(list.plans[1]).toMatchObject({ name: "Premium", reach: "Up to 20 countries", currency: "USD" });
    expect(list.current.tier).toBe("FREE");
    expect(list.methods).toEqual(["CARD", "PAYPAL"]);
    expect(list.paymentsAvailable).toBe(true);
  });

  it("says plainly when no payment provider is connected, and records the failed start without charging", async () => {
    const user = await makeUser();
    const none = new CountryLinqaPlans(db, config, unconfiguredPlanPayments);
    const list = await none.list(user);
    expect(list.paymentsAvailable).toBe(false);
    expect(list.methods).toEqual([]);
    const result = await none.createCheckout(user, { planCode: "PREMIUM", method: "CARD", idempotencyKey: key() });
    expect(result).toMatchObject({ state: "FAILED", failureCode: "PAYMENT_NOT_CONFIGURED", checkoutUrl: null });
  });

  it("starts a payment at the catalog price, and the same key gives the same attempt", async () => {
    const user = await makeUser();
    calls.length = 0;
    const k = key();
    const first = await plans.createCheckout(user, { planCode: "PREMIUM", method: "CARD", idempotencyKey: k });
    expect(first).toMatchObject({ state: "CREATED", amountMinor: 499, currency: "USD", method: "CARD", checkoutUrl: `https://pay.test/${user}:${k}` });
    const again = await plans.createCheckout(user, { planCode: "PREMIUM", method: "CARD", idempotencyKey: k });
    expect(again.id).toBe(first.id);
    expect(calls).toEqual([{ planCode: "PREMIUM", amountMinor: 499, method: "CARD" }]); // the provider was asked once
    await expect(plans.createCheckout(user, { planCode: "ELITE", method: "CARD", idempotencyKey: k })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const other = await plans.createCheckout(await makeUser(), { planCode: "PREMIUM", method: "CARD", idempotencyKey: k });
    expect(other.id).not.toBe(first.id);
  });

  it("concurrent retries create one provider checkout and one owned attempt", async () => {
    const user = await makeUser(); const k = key(); calls.length = 0;
    const results = await Promise.all(Array.from({ length: 8 }, () => plans.createCheckout(user, { planCode: "PREMIUM", method: "CARD", idempotencyKey: k })));
    expect(new Set(results.map(result => result.id)).size).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("refuses a plan that is not a step up, an unknown plan, and a method the provider does not take", async () => {
    const user = await makeUser();
    await setPlan(user, "PREMIUM");
    await expect(plans.createCheckout(user, { planCode: "PREMIUM", method: "CARD", idempotencyKey: key() })).rejects.toMatchObject({ code: "PLAN_NOT_AN_UPGRADE", status: 409 });
    await expect(plans.createCheckout(user, { planCode: "FREE", method: "CARD", idempotencyKey: key() })).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
    expect((await plans.createCheckout(user, { planCode: "ELITE", method: "CARD", idempotencyKey: key() })).state).toBe("CREATED"); // Premium to Elite is an upgrade
    const other = await makeUser();
    expect(await plans.createCheckout(other, { planCode: "PREMIUM", method: "APPLE_PAY", idempotencyKey: key() })).toMatchObject({ state: "FAILED", failureCode: "METHOD_NOT_AVAILABLE" });
  });

  it("a provider that errors is a recorded failure, not a crash", async () => {
    const broken = new CountryLinqaPlans(db, config, { ...provider, createCheckout: async () => { throw new Error("boom"); } });
    const user = await makeUser();
    expect(await broken.createCheckout(user, { planCode: "PREMIUM", method: "CARD", idempotencyKey: key() })).toMatchObject({ state: "FAILED", failureCode: "PAYMENT_START_FAILED" });
  });

  it("success is read from the subscription billing confirmed, never from the app", async () => {
    const user = await makeUser();
    const checkout = await plans.createCheckout(user, { planCode: "PREMIUM", method: "CARD", idempotencyKey: key() });
    expect((await plans.get(user, checkout.id)).state).toBe("CREATED"); // nothing paid yet
    await setPlan(user, "PREMIUM");
    expect((await plans.get(user, checkout.id)).state).toBe("SUCCEEDED");
    await setPlan(user, "PREMIUM", "PAST_DUE"); // a lapsed plan does not count
    expect((await plans.get(user, checkout.id)).state).toBe("CREATED");
  });

  it("only the person who started it can read or cancel it, and a finished attempt stays finished", async () => {
    const user = await makeUser(); const other = await makeUser();
    const checkout = await plans.createCheckout(user, { planCode: "PREMIUM", method: "PAYPAL", idempotencyKey: key() });
    await expect(plans.get(other, checkout.id)).rejects.toMatchObject({ code: "CHECKOUT_NOT_FOUND", status: 404 });
    await expect(plans.cancel(other, checkout.id)).rejects.toMatchObject({ code: "CHECKOUT_NOT_FOUND" });
    expect(await plans.cancel(user, checkout.id)).toMatchObject({ state: "CANCELED", checkoutUrl: null });
    expect(await plans.cancel(user, checkout.id)).toMatchObject({ state: "CANCELED" }); // canceling twice is fine
    const failed = await new CountryLinqaPlans(db, config, unconfiguredPlanPayments).createCheckout(user, { planCode: "PREMIUM", method: "CARD", idempotencyKey: key() });
    expect((await plans.cancel(user, failed.id)).state).toBe("FAILED");
  });

  it("PlanError carries a status", () => {
    expect(new PlanError("X", 418).status).toBe(418);
  });
});

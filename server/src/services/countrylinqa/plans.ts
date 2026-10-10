import type { Database } from "../../db/pool.js";
import type { AppConfig } from "../../config.js";
import { subscriptionSummary, type SubscriptionSummary } from "./world.js";

export type PaymentMethod = "CARD" | "APPLE_PAY" | "GOOGLE_PAY" | "PAYPAL";
export const PAYMENT_METHODS: PaymentMethod[] = ["CARD", "APPLE_PAY", "GOOGLE_PAY", "PAYPAL"];

export class PlanError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

/** The payment company behind checkout. Nothing is charged unless a real one is plugged in. */
export interface PlanPaymentProvider {
  readonly name: string;
  /** Methods this provider can take. Empty when none is connected. */
  methods(): PaymentMethod[];
  createCheckout(input: { userId: string; planCode: string; amountMinor: number; currency: string; method: PaymentMethod; idempotencyKey: string }): Promise<{ sessionRef: string; checkoutUrl: string | null }>;
}

export const unconfiguredPlanPayments: PlanPaymentProvider = {
  name: "unconfigured",
  methods: () => [],
  async createCheckout() { throw new PlanError("PAYMENT_NOT_CONFIGURED", 503); }
};

export type CheckoutState = "CREATED" | "CANCELED" | "FAILED" | "SUCCEEDED";
const RANK: Record<SubscriptionSummary["tier"], number> = { FREE: 0, PREMIUM: 1, ELITE: 2 };

/** What each plan unlocks. These are the things the app really gates by plan, nothing more. */
export function planFeatures(planCode: string, premiumCountryLimit: number): string[] {
  if (planCode === "PREMIUM") return [`Up to ${premiumCountryLimit} countries`, "Discover by region", "Choose which countries can chat you"];
  if (planCode === "ELITE") return ["Worldwide discovery", "Up to 250 countries", "Everything in Premium"];
  return ["Discover people in your own country"];
}

export class CountryLinqaPlans {
  constructor(private readonly db: Database, private readonly config: Pick<AppConfig, "COUNTRY_SELECTION_PREMIUM_LIMIT">, private readonly provider: PlanPaymentProvider = unconfiguredPlanPayments) {}

  async list(userId: string) {
    const [sub, catalog] = await Promise.all([
      subscriptionSummary(this.db, userId),
      this.db.query("SELECT plan_code, display_name, monthly_price_minor, currency FROM countrylinqa_plan_catalog WHERE active = TRUE ORDER BY tier_rank")
    ]);
    const limit = this.config.COUNTRY_SELECTION_PREMIUM_LIMIT;
    return {
      current: { tier: sub.tier, status: sub.status, provider: sub.provider, currentPeriodEnd: sub.currentPeriodEnd },
      paymentsAvailable: this.provider.methods().length > 0,
      methods: this.provider.methods(),
      plans: [
        { code: "FREE", name: "Free", reach: "My Country only", monthlyPriceMinor: 0, currency: "USD", features: planFeatures("FREE", limit) },
        ...catalog.rows.map((r) => ({
          code: r.plan_code as string, name: r.display_name as string, monthlyPriceMinor: Number(r.monthly_price_minor), currency: String(r.currency).trim(),
          reach: r.plan_code === "ELITE" ? "Worldwide" : `Up to ${limit} countries`, features: planFeatures(r.plan_code as string, limit)
        }))
      ]
    };
  }

  /**
   * Starts a payment for a plan. The price comes from the catalog, never from the request; the plan
   * must be a step up from the current one; and the same idempotency key always returns the same attempt.
   */
  async createCheckout(userId: string, input: { planCode: string; method: PaymentMethod; idempotencyKey: string }) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const user = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      if (!user.rowCount) throw new PlanError("CHECKOUT_NOT_FOUND", 404);
      const result = await new CountryLinqaPlans(client as unknown as Database, this.config, this.provider).createCheckoutAttempt(userId, input);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async createCheckoutAttempt(userId: string, input: { planCode: string; method: PaymentMethod; idempotencyKey: string }) {
    const plan = await this.db.query("SELECT plan_code, tier_rank, monthly_price_minor, currency FROM countrylinqa_plan_catalog WHERE plan_code = $1 AND active = TRUE", [input.planCode]);
    if (!plan.rowCount) throw new PlanError("PLAN_NOT_FOUND", 404);
    const sub = await subscriptionSummary(this.db, userId);
    if (RANK[sub.tier] >= Number(plan.rows[0].tier_rank)) throw new PlanError("PLAN_NOT_AN_UPGRADE", 409);

    const old = await this.db.query("SELECT id, user_id, plan_code, payment_method FROM countrylinqa_checkouts WHERE idempotency_key = $1 AND user_id = $2", [input.idempotencyKey, userId]);
    if (old.rowCount) {
      const r = old.rows[0];
      if (r.user_id !== userId || r.plan_code !== input.planCode || r.payment_method !== input.method) throw new PlanError("IDEMPOTENCY_KEY_REUSED", 409);
      return this.get(userId, r.id as string);
    }

    const amountMinor = Number(plan.rows[0].monthly_price_minor);
    const currency = String(plan.rows[0].currency).trim();
    const methods = this.provider.methods();
    let failure: string | null = null;
    let session: { sessionRef: string; checkoutUrl: string | null } | null = null;
    if (!methods.includes(input.method)) failure = methods.length === 0 ? "PAYMENT_NOT_CONFIGURED" : "METHOD_NOT_AVAILABLE";
    else {
      try { session = await this.provider.createCheckout({ userId, planCode: input.planCode, amountMinor, currency, method: input.method, idempotencyKey: `${userId}:${input.idempotencyKey}` }); }
      catch (error) { failure = error instanceof PlanError ? error.code : "PAYMENT_START_FAILED"; }
    }
    // The attempt is recorded either way, so a failed start still shows up as "Payment failed".
    const row = await this.db.query(
      `INSERT INTO countrylinqa_checkouts (user_id, plan_code, payment_method, amount_minor, currency, provider, provider_session_ref, checkout_url, state, failure_code, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [userId, input.planCode, input.method, amountMinor, currency, this.provider.name, session?.sessionRef ?? null, session?.checkoutUrl ?? null, failure ? "FAILED" : "CREATED", failure, input.idempotencyKey]
    );
    return this.get(userId, row.rows[0].id as string);
  }

  /** The attempt as it stands now. Success is read from the subscription billing confirmed, not from the app. */
  async get(userId: string, id: string) {
    const { rows } = await this.db.query(
      "SELECT id, plan_code, payment_method, amount_minor, currency, state, failure_code, checkout_url, created_at FROM countrylinqa_checkouts WHERE id = $1 AND user_id = $2", [id, userId]
    );
    const r = rows[0];
    if (!r) throw new PlanError("CHECKOUT_NOT_FOUND", 404);
    const rank = await this.db.query("SELECT tier_rank FROM countrylinqa_plan_catalog WHERE plan_code = $1", [r.plan_code]);
    const sub = await subscriptionSummary(this.db, userId);
    // If billing says the plan is active, the payment worked, whatever this attempt last recorded.
    const confirmed = RANK[sub.tier] >= Number(rank.rows[0]?.tier_rank ?? 99);
    const state: CheckoutState = confirmed ? "SUCCEEDED" : (r.state as CheckoutState);
    return {
      id: r.id as string, planCode: r.plan_code as string, method: r.payment_method as PaymentMethod, amountMinor: Number(r.amount_minor), currency: String(r.currency).trim(),
      state, failureCode: (r.failure_code as string | null) ?? null, checkoutUrl: state === "CREATED" ? ((r.checkout_url as string | null) ?? null) : null
    };
  }

  /** The person backed out. Only an attempt that has not finished can be canceled. */
  async cancel(userId: string, id: string) {
    const { rows } = await this.db.query("UPDATE countrylinqa_checkouts SET state = 'CANCELED', updated_at = now() WHERE id = $1 AND user_id = $2 AND state = 'CREATED' RETURNING id", [id, userId]);
    if (!rows.length) await this.get(userId, id); // 404 for someone else's, otherwise already finished
    return this.get(userId, id);
  }
}

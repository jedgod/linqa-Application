import crypto from "node:crypto";
import type { Pool } from "pg";
import { ProviderUnavailableError, type BillingProvider } from "../integrations/vault/production-contracts.js";
import { requireWorkspace, VaultError } from "./vault-access.js";

const FREE_PLAN = "FREE_5GB";

/**
 * Plan changes. The plan and its size come from vault_plans on the server; a price or quota sent
 * by the client is never read. Entitlements change only from a webhook whose signature verified
 * over the exact raw bytes, and each provider event id is applied once.
 */
export class VaultBillingService {
  constructor(private readonly db: Pool, private readonly provider: BillingProvider, private readonly allowedReturnOrigins: string[]) {}

  private checkReturnUrl(value: string) {
    let url: URL;
    try { url = new URL(value); } catch { throw new VaultError("INVALID_RETURN_URL", 400); }
    if (url.protocol !== "https:" || !this.allowedReturnOrigins.includes(url.origin)) throw new VaultError("INVALID_RETURN_URL", 400);
  }

  async checkout(userId: string, input: { workspaceId?: string | undefined; planCode: string; successUrl: string; cancelUrl: string; idempotencyKey: string }) {
    if (this.provider.name === "unconfigured") throw new VaultError("BILLING_NOT_CONFIGURED", 503);
    if (this.allowedReturnOrigins.length === 0) throw new VaultError("BILLING_RETURN_URLS_NOT_CONFIGURED", 503);
    this.checkReturnUrl(input.successUrl);
    this.checkReturnUrl(input.cancelUrl);
    if (input.planCode === FREE_PLAN) throw new VaultError("PLAN_NOT_PURCHASABLE", 400);
    const plan = await this.db.query("SELECT code FROM vault_plans WHERE code = $1 AND active = true AND kind = 'CONSUMER'", [input.planCode]);
    if (!plan.rowCount) throw new VaultError("PLAN_NOT_FOUND", 404);
    const workspace = await requireWorkspace(this.db, userId, input.workspaceId, true);
    if (workspace.owner_user_id !== userId) throw new VaultError("VAULT_FORBIDDEN", 403);

    const old = await this.db.query("SELECT user_id, plan_code, provider_session_ref, checkout_url, state FROM vault_billing_checkouts WHERE idempotency_key = $1", [input.idempotencyKey]);
    if (old.rowCount) {
      if (old.rows[0].user_id !== userId || old.rows[0].plan_code !== input.planCode) throw new VaultError("IDEMPOTENCY_KEY_REUSED", 409);
      return { checkoutUrl: old.rows[0].checkout_url as string, sessionRef: old.rows[0].provider_session_ref as string };
    }
    const customer = await this.db.query("SELECT provider_customer_ref FROM vault_billing_customers WHERE user_id = $1", [userId]);
    let out;
    try {
      out = await this.provider.createCheckout({ customerRef: customer.rows[0]?.provider_customer_ref as string | undefined, userId, planCode: input.planCode, successUrl: input.successUrl, cancelUrl: input.cancelUrl, idempotencyKey: input.idempotencyKey });
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw new VaultError(error.code, 503);
      throw error;
    }
    if (out.customerRef) {
      await this.db.query("INSERT INTO vault_billing_customers (user_id, provider_customer_ref) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET provider_customer_ref = excluded.provider_customer_ref", [userId, out.customerRef]);
    }
    await this.db.query(
      "INSERT INTO vault_billing_checkouts (user_id, workspace_id, plan_code, provider, provider_session_ref, idempotency_key, checkout_url) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [userId, workspace.id, input.planCode, this.provider.name, out.sessionRef, input.idempotencyKey, out.checkoutUrl]
    );
    return { checkoutUrl: out.checkoutUrl, sessionRef: out.sessionRef };
  }

  /** Called with the untouched request body. A bad signature is rejected before anything is recorded. */
  async webhook(raw: Buffer, signature: string) {
    if (this.provider.name === "unconfigured") throw new VaultError("BILLING_NOT_CONFIGURED", 503);
    let event;
    try {
      event = await this.provider.verifyWebhook(raw, signature);
    } catch {
      throw new VaultError("WEBHOOK_SIGNATURE_INVALID", 400);
    }
    const rawSha = crypto.createHash("sha256").update(raw).digest("hex");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        "INSERT INTO vault_billing_events (provider, provider_event_id, raw_sha256, verified, state) VALUES ($1,$2,$3,true,'RECEIVED') ON CONFLICT DO NOTHING RETURNING provider_event_id",
        [this.provider.name, event.eventId, rawSha]
      );
      if (!inserted.rowCount) { await client.query("ROLLBACK"); return { duplicate: true as const }; }

      if (event.type === "subscription.active" && event.userId && event.planCode) {
        const plan = await client.query("SELECT code, quota_bytes FROM vault_plans WHERE code = $1 AND active = true AND kind = 'CONSUMER'", [event.planCode]);
        if (!plan.rowCount) {
          await client.query("UPDATE vault_billing_events SET state = 'QUARANTINED', processed_at = now() WHERE provider = $1 AND provider_event_id = $2", [this.provider.name, event.eventId]);
          await client.query("COMMIT");
          return { quarantined: true as const };
        }
        await this.applyPlan(client, event.userId, event.planCode, event.subscriptionRef, event.periodEnd);
        if (event.sessionRef) await client.query("UPDATE vault_billing_checkouts SET state = 'COMPLETED', completed_at = now() WHERE provider_session_ref = $1", [event.sessionRef]);
      } else if (event.type === "subscription.canceled" && event.userId) {
        await this.applyPlan(client, event.userId, FREE_PLAN, undefined, undefined);
      }
      await client.query("UPDATE vault_billing_events SET state = 'PROCESSED', processed_at = now() WHERE provider = $1 AND provider_event_id = $2", [this.provider.name, event.eventId]);
      await client.query("COMMIT");
      return { processed: true as const };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyPlan(client: { query: Pool["query"] }, userId: string, planCode: string, subscriptionRef: string | undefined, periodEnd: string | undefined) {
    await client.query(
      "UPDATE vault_workspaces SET plan_code = $2, quota_bytes = (SELECT quota_bytes FROM vault_plans WHERE code = $2), updated_at = now() WHERE owner_user_id = $1 AND kind = 'CONSUMER'",
      [userId, planCode]
    );
    await client.query(
      `INSERT INTO vault_entitlements (user_id, plan_code, status, provider_subscription_id, current_period_end)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET plan_code = excluded.plan_code, status = excluded.status, provider_subscription_id = excluded.provider_subscription_id, current_period_end = excluded.current_period_end, updated_at = now()`,
      [userId, planCode, planCode === FREE_PLAN ? "FREE" : "ACTIVE", subscriptionRef ?? null, periodEnd ?? null]
    );
  }
}

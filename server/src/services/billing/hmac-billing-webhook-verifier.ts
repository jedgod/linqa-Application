import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingWebhookVerifier } from "../billing-reconciliation.service.js";

/**
 * Real implementation of BillingWebhookVerifier (2026-08-07). Signature
 * scheme matches the widely-used "timestamped HMAC" convention (the same
 * shape as Stripe's `Stripe-Signature` header: `t=<unix-seconds>,v1=<hex
 * hmac-sha256>`), which most billing/payment platforms either produce
 * natively or can be configured to produce via an outbound-webhook relay.
 * The payload schema below ("Linqa Billing Webhook" contract, documented in
 * docs/BILLING_WEBHOOK_CONTRACT.md) is one this integration defines itself,
 * since the source pack's BillingWebhookVerifier interface is generic and
 * doesn't commit to one specific provider's payload shape — an operator
 * wiring a real provider (Stripe, Paddle, a custom billing system) adapts
 * that provider's webhook to this JSON shape and this HMAC scheme, either
 * natively or via a small relay function. The cryptographic verification
 * and replay/tamper protection here are real and provider-agnostic.
 */
export class HmacBillingWebhookVerifier implements BillingWebhookVerifier {
  constructor(
    private readonly secret: string,
    private readonly toleranceSeconds: number
  ) {}

  async verify(input: { rawBody: Buffer; signature: string }): ReturnType<BillingWebhookVerifier["verify"]> {
    const parts = Object.fromEntries(
      input.signature
        .split(",")
        .map((part) => part.trim().split("="))
        .filter((pair): pair is [string, string] => pair.length === 2)
    );

    const timestamp = parts.t;
    const providedMac = parts.v1;
    if (!timestamp || !providedMac) {
      throw new Error("malformed billing webhook signature header");
    }

    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds)) {
      throw new Error("malformed billing webhook signature timestamp");
    }
    if (Math.abs(Date.now() / 1000 - timestampSeconds) > this.toleranceSeconds) {
      throw new Error("billing webhook signature timestamp outside tolerance");
    }

    const expectedMac = createHmac("sha256", this.secret)
      .update(`${timestamp}.`)
      .update(input.rawBody)
      .digest("hex");

    const expected = Buffer.from(expectedMac, "hex");
    const provided = Buffer.from(providedMac, "hex");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new Error("billing webhook signature verification failed");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody.toString("utf8"));
    } catch {
      throw new Error("billing webhook payload is not valid JSON");
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("billing webhook payload must be a JSON object");
    }

    const body = payload as Record<string, unknown>;
    if (typeof body.id !== "string" || typeof body.type !== "string") {
      throw new Error("billing webhook payload missing required id/type fields");
    }

    return {
      id: body.id,
      type: body.type,
      ...(typeof body.userId === "string" ? { userId: body.userId } : {}),
      ...(typeof body.entitlementKey === "string" ? { entitlementKey: body.entitlementKey } : {}),
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      ...(typeof body.expiresAt === "string" ? { expiresAt: new Date(body.expiresAt) } : {})
    };
  }
}

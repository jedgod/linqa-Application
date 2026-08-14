import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Genuinely new capability: LinqaSend previously had no webhook endpoint at
 * all, so a real funding/payout provider had no way to push async status
 * updates back in. Deliberately follows the SAME timestamped-HMAC
 * convention already established by `services/billing/
 * hmac-billing-webhook-verifier.ts` (`t=<unix-seconds>,v1=<hex hmac-sha256>`,
 * the Stripe-Signature shape) rather than inventing a second webhook
 * signature scheme for a second domain — one verification convention,
 * reused across billing and LinqaSend.
 *
 * Fails closed: with no secret configured (the expected state until a real
 * funding/payout provider is wired up), every signature is rejected.
 */
export function verifyLinqaSendWebhookSignature(input: {
  secret: string | undefined;
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
  toleranceSeconds?: number;
}): { valid: boolean; reason?: string } {
  if (!input.secret) {
    return { valid: false, reason: "webhook_secret_not_configured" };
  }
  if (!input.signatureHeader) {
    return { valid: false, reason: "missing_signature_header" };
  }

  const parts = Object.fromEntries(
    input.signatureHeader
      .split(",")
      .map((part) => part.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2)
  );
  const timestamp = parts.t;
  const providedMac = parts.v1;
  if (!timestamp || !providedMac) {
    return { valid: false, reason: "malformed_signature_header" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { valid: false, reason: "malformed_signature_timestamp" };
  }
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > tolerance) {
    return { valid: false, reason: "signature_timestamp_outside_tolerance" };
  }

  const expectedMac = createHmac("sha256", input.secret)
    .update(`${timestamp}.`)
    .update(input.rawBody)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedMac, "hex");
  const providedBuf = Buffer.from(providedMac, "hex");
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return { valid: false, reason: "signature_mismatch" };
  }
  return { valid: true };
}

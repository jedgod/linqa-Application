# Linqa Billing Webhook Contract

`HmacBillingWebhookVerifier` (server/src/services/billing/hmac-billing-webhook-verifier.ts)
verifies inbound billing webhooks against `BILLING_WEBHOOK_SECRET`.

## Signature header

`x-billing-signature: t=<unix-seconds>,v1=<hex-encoded HMAC-SHA256>`

The HMAC is computed over `"${t}."` concatenated with the raw request body
bytes, keyed with `BILLING_WEBHOOK_SECRET`. This is the same scheme Stripe
uses for `Stripe-Signature` — a provider that already speaks this format
can be pointed at `/v3/billing/webhook` directly. A provider using a
different scheme needs a small relay/transform step in front of Linqa that
re-signs the payload this way; the payload contents do not need to be
Stripe's own event shape (see below), only the signature header format.

Requests older than `BILLING_WEBHOOK_TOLERANCE_SECONDS` (default 300) are
rejected as expired, mitigating replay of a captured webhook body+signature.

## Payload shape

```json
{
  "id": "evt_...",              // required, unique per event — used for idempotency
  "type": "entitlement.updated",// required
  "userId": "uuid",             // optional — required to update an entitlement
  "entitlementKey": "premium",  // optional — required to update an entitlement
  "active": true,                // optional
  "expiresAt": "2027-01-01T00:00:00Z" // optional, ISO 8601
}
```

Events without `userId`/`entitlementKey` are recorded (for idempotency and
audit) but do not update `entitlements`.

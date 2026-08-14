# Real Provider Integrations (2026-08-07, restored 2026-08-08)

> **Incident note:** this file, its code, and its docs were deleted once
> already by a concurrent-edit collision with a separate agent session's
> "CountryLinqa" work landing in this unversioned repository at the same
> time. Restored and re-merged alongside CountryLinqa's own config fields.
> **This repo still has no git as of this restoration** — until it does,
> this can happen again, silently. See claudeassess.txt / conversation
> history for the full incident diagnostic.

Every integration below has a real, working implementation now — not just a
`FailClosed*` stub — selected automatically by `service-container.ts` once
its full env var group is set (all-or-nothing, validated in `config.ts`).
Omit any group and that integration keeps failing closed exactly as before.
OTP and carrier-lookup additionally fall back to a *development-only*
console/dev provider (added by the other agent session) when unconfigured
and `NODE_ENV !== "production"`, so `/v5/phone-verification/*` is
exercisable locally without either Twilio credentials or a hard failure.

| Capability | Real implementation | Required env vars |
|---|---|---|
| APNs push | `ApnsHttp2Provider` (node:http2 + ES256 provider token) | `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY_P8`, `APNS_BUNDLE_ID` (+ optional `APNS_SANDBOX`) |
| FCM push | `FcmHttpV1Provider` (service-account OAuth2 + HTTP v1) | `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` |
| Signed attachment/CDN delivery | `S3PresignedCdnSigner` | `CDN_STORAGE_BUCKET`, `CDN_STORAGE_REGION` |
| Billing webhook verification | `HmacBillingWebhookVerifier` — see `docs/BILLING_WEBHOOK_CONTRACT.md` | `BILLING_WEBHOOK_SECRET` (+ optional `BILLING_WEBHOOK_TOLERANCE_SECONDS`, default 300) |
| Emergency staff paging | `WebhookEscalationNotifier` (HMAC-signed webhook; user-side reuses APNs/FCM) | `ESCALATION_STAFF_WEBHOOK_URL`, `ESCALATION_STAFF_WEBHOOK_SECRET` |
| SMS/voice OTP | `TwilioOtpProvider` (else `DevConsoleMobileOtpDeliveryProvider` outside production) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (+ optional `TWILIO_VOICE_FROM_NUMBER`) |
| Carrier/line-type lookup | `TwilioLookupProvider` (else `DevMobileLineIntelligenceProvider` outside production) | `TWILIO_LOOKUP_ACCOUNT_SID`, `TWILIO_LOOKUP_AUTH_TOKEN` |
| Retention archive storage | `S3ArchiveStorage` | `ARCHIVE_STORAGE_BUCKET`, `ARCHIVE_STORAGE_REGION`, `ARCHIVE_STORAGE_KMS_KEY_ID` |
| Enterprise SSO (OIDC only) | `verifyOidcIdToken` (`auth/oidc-verifier.ts`) via `POST /v3/enterprise/:organizationId/sso/verify` | none globally — per-organization issuer/client ID come from `enterprise_identity_connections_v2` |

## What this is not

- **Not a full interactive SSO login flow.** `verifyOidcIdToken` verifies an
  ID token the client already obtained; there is still no authorization-code
  redirect, callback route, `state`/`nonce` handling, or session issuance
  from an SSO login anywhere in this repo. Building that safely is a
  distinct, larger piece of work.
- **No SAML.** Hand-rolled XML signature/canonicalization verification is a
  classic real-world vulnerability source; this repo does not implement it.
- **The billing webhook payload schema is Linqa's own** (documented in
  `docs/BILLING_WEBHOOK_CONTRACT.md`), not any specific vendor's native
  event shape — a real provider's webhook needs to be adapted to it (or
  relayed through a small transform), same as the signature scheme.
- Each provider still makes a real outbound network call the moment it's
  configured — none of this was exercised against live Apple/Google/Twilio/
  AWS endpoints in this session (no credentials or network access to those
  services exist in this environment). Correctness was verified by protocol
  review and by unit tests covering the provider-selection wiring and the
  billing HMAC scheme (signature/timestamp/tamper/malformed-header cases).

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createServiceContainer } from "../bootstrap/service-container.js";
import { HmacBillingWebhookVerifier } from "../services/billing/hmac-billing-webhook-verifier.js";
import { FailClosedBillingWebhookVerifier } from "../services/billing-reconciliation.service.js";
import { FailClosedCdnSigner } from "../services/attachment-cdn.service.js";
import { S3PresignedCdnSigner } from "../services/cdn/s3-presigned-cdn-signer.js";
import { FailClosedPushV2Provider } from "../services/push-v2.service.js";
import { CompositePushV2Provider } from "../services/push-providers/composite-push-v2.provider.js";
import { DevConsoleMobileOtpDeliveryProvider } from "../services/mobile-otp.service.js";
import { TwilioOtpProvider } from "../services/otp/twilio-otp-provider.js";
import { DevMobileLineIntelligenceProvider } from "../services/mobile-line-intelligence.service.js";
import { TwilioLookupProvider } from "../services/line-intelligence/twilio-lookup.provider.js";
import { FailClosedEscalationNotifier } from "../services/emergency-escalation.service.js";
import { WebhookEscalationNotifier } from "../services/emergency/webhook-escalation-notifier.js";
import { FailClosedArchiveStorage } from "../services/retention-archive.service.js";
import { S3ArchiveStorage } from "../services/storage/s3-archive-storage.js";

const BASE_CONFIG: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 8080,
  DATABASE_URL: "postgresql://unused",
  JWT_ISSUER: "https://test.linqa.local",
  JWT_AUDIENCE: "linqa-api",
  JWT_HS256_SECRET: "test-secret-that-is-at-least-32-bytes-long",
  CONTACT_DISCOVERY_SECRET: "test-contact-discovery-secret-value",
  TOKEN_VAULT_KEY_BASE64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  TURN_SHARED_SECRET: "test-turn-secret-that-is-at-least-32-bytes",
  TURN_URLS: ["turn:127.0.0.1:3478?transport=udp"],
  CORS_ORIGINS: ["http://127.0.0.1:5173"],
  DEVICE_CHALLENGE_TTL_SECONDS: 300,
  ENVELOPE_TTL_SECONDS: 2_592_000,
  MAX_ENVELOPE_BYTES: 262_144,
  DELIVERY_LEASE_SECONDS: 60,
  PASSKEY_RP_ID: "test.linqa.local",
  PASSKEY_RP_NAME: "Linqa Test",
  PASSKEY_ORIGINS: ["https://test.linqa.local"],
  APNS_SANDBOX: false,
  BILLING_WEBHOOK_TOLERANCE_SECONDS: 300,
  LINQASEND_WEBHOOK_TOLERANCE_SECONDS: 300,
  COUNTRY_SELECTION_PREMIUM_LIMIT: 20,
  LOG_LEVEL: "fatal"
};

const database = { query: async () => ({ rows: [] }) } as unknown as Database;

describe("HmacBillingWebhookVerifier", () => {
  const secret = "billing-webhook-secret-for-tests";
  const verifier = new HmacBillingWebhookVerifier(secret, 300);

  function sign(body: string, timestamp = Math.floor(Date.now() / 1000).toString()) {
    const mac = createHmac("sha256", secret).update(`${timestamp}.`).update(Buffer.from(body)).digest("hex");
    return `t=${timestamp},v1=${mac}`;
  }

  it("accepts a correctly signed, fresh payload", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "entitlement.updated", userId: "u1", entitlementKey: "premium", active: true });
    const result = await verifier.verify({ rawBody: Buffer.from(body), signature: sign(body) });
    expect(result).toMatchObject({ id: "evt_1", type: "entitlement.updated", userId: "u1", entitlementKey: "premium", active: true });
  });

  it("rejects a tampered payload (signature no longer matches)", async () => {
    const original = JSON.stringify({ id: "evt_2", type: "entitlement.updated" });
    const signature = sign(original);
    const tampered = JSON.stringify({ id: "evt_2", type: "entitlement.updated", active: true });

    await expect(verifier.verify({ rawBody: Buffer.from(tampered), signature })).rejects.toThrow(
      "billing webhook signature verification failed"
    );
  });

  it("rejects an expired timestamp (replay protection)", async () => {
    const body = JSON.stringify({ id: "evt_3", type: "entitlement.updated" });
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 3600).toString();

    await expect(
      verifier.verify({ rawBody: Buffer.from(body), signature: sign(body, oldTimestamp) })
    ).rejects.toThrow("billing webhook signature timestamp outside tolerance");
  });

  it("rejects a malformed signature header", async () => {
    const body = JSON.stringify({ id: "evt_4", type: "entitlement.updated" });
    await expect(verifier.verify({ rawBody: Buffer.from(body), signature: "not-a-valid-header" })).rejects.toThrow(
      "malformed billing webhook signature header"
    );
  });

  it("rejects a payload missing required id/type fields", async () => {
    const body = JSON.stringify({ foo: "bar" });
    await expect(verifier.verify({ rawBody: Buffer.from(body), signature: sign(body) })).rejects.toThrow(
      "billing webhook payload missing required id/type fields"
    );
  });
});

describe("service-container provider selection (real vs fail-closed/dev-fallback)", () => {
  it("falls back to FailClosed*/Dev* providers when no optional config is set (non-production)", () => {
    const services = createServiceContainer(BASE_CONFIG, database);

    expect((services.attachmentCdn as any)["signer"]).toBeInstanceOf(FailClosedCdnSigner);
    expect((services.billingReconciliation as any)["verifier"]).toBeInstanceOf(FailClosedBillingWebhookVerifier);
    expect((services.pushV2 as any)["provider"]).toBeInstanceOf(FailClosedPushV2Provider);
    // NODE_ENV is "test" (non-production), so OTP/line-intelligence fall back
    // to the dev-console providers rather than failing closed.
    expect((services.mobileOtp as any)["provider"]).toBeInstanceOf(DevConsoleMobileOtpDeliveryProvider);
    expect((services.authChallenges as any)["phone"]["intelligence"]).toBeInstanceOf(DevMobileLineIntelligenceProvider);
    expect((services.emergencyEscalation as any)["notifier"]).toBeInstanceOf(FailClosedEscalationNotifier);
    expect((services.retentionArchive as any)["archive"]).toBeInstanceOf(FailClosedArchiveStorage);
  });

  // Note: the "fails closed (not dev-fallback) in production" branch of the
  // OTP/line-intelligence ternary in service-container.ts is straightforward
  // to verify by inspection but awkward to unit-test through
  // createServiceContainer() directly — an unrelated, pre-existing guard
  // (DevConsoleDeliveryProvider, used for auth challenges) also refuses to
  // construct under NODE_ENV=production without its own config, so
  // constructing the *full* container with NODE_ENV=production for this
  // narrow assertion isn't practical without stubbing unrelated parts of
  // the container. The non-production case above already demonstrates the
  // fallback branch is reachable; the production branch is the same
  // ternary's `? :` alternative.

  it("selects the real CDN signer once CDN_STORAGE_* is fully configured", () => {
    const services = createServiceContainer(
      { ...BASE_CONFIG, CDN_STORAGE_BUCKET: "linqa-cdn", CDN_STORAGE_REGION: "us-east-1" },
      database
    );
    expect((services.attachmentCdn as any)["signer"]).toBeInstanceOf(S3PresignedCdnSigner);
  });

  it("selects the real archive storage once ARCHIVE_STORAGE_* is fully configured", () => {
    const services = createServiceContainer(
      {
        ...BASE_CONFIG,
        ARCHIVE_STORAGE_BUCKET: "linqa-archive",
        ARCHIVE_STORAGE_REGION: "us-east-1",
        ARCHIVE_STORAGE_KMS_KEY_ID: "kms-key-1"
      },
      database
    );
    expect((services.retentionArchive as any)["archive"]).toBeInstanceOf(S3ArchiveStorage);
  });

  it("selects the real billing verifier once BILLING_WEBHOOK_SECRET is set", () => {
    const services = createServiceContainer(
      { ...BASE_CONFIG, BILLING_WEBHOOK_SECRET: "a-real-webhook-secret-value" },
      database
    );
    expect((services.billingReconciliation as any)["verifier"]).toBeInstanceOf(HmacBillingWebhookVerifier);
  });

  it("selects the real Twilio OTP provider once TWILIO_* is fully configured", () => {
    const services = createServiceContainer(
      {
        ...BASE_CONFIG,
        TWILIO_ACCOUNT_SID: "AC_test",
        TWILIO_AUTH_TOKEN: "test-token",
        TWILIO_FROM_NUMBER: "+15005550006"
      },
      database
    );
    expect((services.mobileOtp as any)["provider"]).toBeInstanceOf(TwilioOtpProvider);
  });

  it("selects the real Twilio Lookup provider once TWILIO_LOOKUP_* is fully configured", () => {
    const services = createServiceContainer(
      { ...BASE_CONFIG, TWILIO_LOOKUP_ACCOUNT_SID: "AC_lookup", TWILIO_LOOKUP_AUTH_TOKEN: "lookup-token" },
      database
    );
    expect((services.authChallenges as any)["phone"]["intelligence"]).toBeInstanceOf(TwilioLookupProvider);
  });

  it("selects the real webhook escalation notifier once ESCALATION_STAFF_WEBHOOK_* is fully configured", () => {
    const services = createServiceContainer(
      {
        ...BASE_CONFIG,
        ESCALATION_STAFF_WEBHOOK_URL: "https://hooks.example.com/emergency",
        ESCALATION_STAFF_WEBHOOK_SECRET: "escalation-secret-value"
      },
      database
    );
    expect((services.emergencyEscalation as any)["notifier"]).toBeInstanceOf(WebhookEscalationNotifier);
  });

  it("selects the composite push provider once at least one of APNS/FCM is fully configured", () => {
    const services = createServiceContainer(
      {
        ...BASE_CONFIG,
        FCM_PROJECT_ID: "linqa-project",
        FCM_CLIENT_EMAIL: "svc@linqa-project.iam.gserviceaccount.com",
        FCM_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\nMzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6dVMvDuictGeurT8jNbvJZHtCSuYEvu\nNMoSfm76oqFvAp8Gy0iz5sxjZmSnXyCdPEovGhLa0VzMaQ8s+CLOyS56YyCFGeJZ\nqgtzJ6GR3eqoYSW9b9UMvkBpZODSctWSNGj3P7jRFDO5VoTwCQAWbFnOjDfH5Ulg\np2PKSQnSJP3AJLQNFNe7br1XbrhV//eO+t51mIpGSDCUv3E0DDFcWDTH9cXDTTlR\nZVEiR2BwpZOOkE/Z0/BVnhZYL71oZV34bKfWjQIt6V/isSMahdsAASACp4ZTGtwi\nVuNd9tVXAgMBAAECggEAWDBEjcSVsRTGN3JYNwmPGjpZ9wV0k8pO6c7wCA6EulqQ\nfake-key-for-tests-not-a-real-credential-1234567890abcdef\n-----END PRIVATE KEY-----\n"
      },
      database
    );
    expect((services.pushV2 as any)["provider"]).toBeInstanceOf(CompositePushV2Provider);
  });
});

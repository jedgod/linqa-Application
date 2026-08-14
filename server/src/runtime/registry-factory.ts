import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { ConfigurationProvider, ProviderRegistry } from "../providers/provider-registry.js";
import { CapabilityRegistry } from "./capabilities.js";
import { DatabaseProbe } from "./database-probe.js";
import { ProviderCapabilityProbe } from "./provider-probe.js";
import { TableCapabilityProbe } from "./table-probe.js";
import { ArtifactHashProbe } from "./artifact-probe.js";
import { RedisProbe } from "./redis-probe.js";
import { HttpCapabilityProbe } from "./http-probe.js";
import { DerivedCapabilityProbe } from "./derived-probe.js";

export function createRuntimeCapabilityRegistry(config: AppConfig, db: Database, operationalProviders?: ProviderRegistry): CapabilityRegistry {
  const providers = new ProviderRegistry()
    .register(new ConfigurationProvider("apns", "apns-http2", "1", Boolean(config.APNS_TEAM_ID && config.APNS_KEY_ID && config.APNS_PRIVATE_KEY_P8 && config.APNS_BUNDLE_ID)))
    .register(new ConfigurationProvider("fcm", "fcm-http-v1", "1", Boolean(config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL && config.FCM_PRIVATE_KEY)))
    .register(new ConfigurationProvider("turn", "turn-shared-secret", "1", config.TURN_URLS.length > 0 && config.TURN_SHARED_SECRET.length >= 32))
    .register(new ConfigurationProvider("billing", "billing-webhook", "1", Boolean(config.BILLING_WEBHOOK_SECRET)))
    .register(new ConfigurationProvider("kms", "object-storage-kms", "1", Boolean(config.OBJECT_STORAGE_KMS_KEY_ID)))
    .register(new ConfigurationProvider("escalation", "staff-webhook", "1", Boolean(config.ESCALATION_STAFF_WEBHOOK_URL && config.ESCALATION_STAFF_WEBHOOK_SECRET)))
    ;

  const database = new DatabaseProbe(db);
  const secureCore = new ArtifactHashProbe("secure-core", config.SECURE_CORE_ARTIFACT_PATH, config.SECURE_CORE_ARTIFACT_SHA256);
  const relay = new TableCapabilityProbe("message-relay", db, ["message_envelopes", "devices"]);
  const transparencyTables = new TableCapabilityProbe("key-transparency-tables", db, ["key_packages", "key_transparency_events"]);
  const transparency = new DerivedCapabilityProbe("key-transparency", [
    transparencyTables,
    new ProviderCapabilityProbe("transparency-checkpoint-signer", config.TRANSPARENCY_PRIVATE_KEY_PEM && config.TRANSPARENCY_PUBLIC_KEY_BASE64
      ? new ConfigurationProvider("transparency-checkpoint-signer", "ed25519-checkpoint", "1", true)
      : undefined)
  ]);
  const smsProvider = operationalProviders?.maybe("sms-delivery");
  const emailProvider = operationalProviders?.maybe("email-delivery");
  const sms = smsProvider ? new ProviderCapabilityProbe("sms-delivery", smsProvider) : new HttpCapabilityProbe(
    "sms-delivery", config.TWILIO_ACCOUNT_SID ? `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.TWILIO_ACCOUNT_SID)}.json` : undefined,
    config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN ? { authorization: `Basic ${Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString("base64")}` } : {}, "GET"
  );
  const email = emailProvider ? new ProviderCapabilityProbe("email-delivery", emailProvider) : new HttpCapabilityProbe("email-delivery", config.EMAIL_DELIVERY_HEALTH_URL, config.EMAIL_DELIVERY_TOKEN ? { authorization: `Bearer ${config.EMAIL_DELIVERY_TOKEN}` } : {});
  const delivery = new DerivedCapabilityProbe("delivery", [sms, email]);
  const enrollment = new TableCapabilityProbe("device-enrollment", db, ["device_registration_challenges", "devices"]);
  const keyVerification = new TableCapabilityProbe("key-package-verification", db, ["key_packages", "devices"]);
  const realtime = new TableCapabilityProbe("realtime", db, ["devices", "auth_sessions"]);

  const registry = new CapabilityRegistry()
    .register(database).register(secureCore).register(new RedisProbe(config.REDIS_URL))
    .register(sms).register(email).register(delivery)
    .register(enrollment).register(keyVerification).register(relay).register(transparency).register(realtime)
    .register(new HttpCapabilityProbe("countrylinqa-risk", config.COUNTRYLINQA_RISK_URL));
  if (operationalProviders) {
    for (const provider of operationalProviders.list()) {
      if (provider.kind !== "sms-delivery" && provider.kind !== "email-delivery") registry.register(new ProviderCapabilityProbe(provider.kind, provider));
    }
  }
  for (const provider of providers.list()) registry.register(new ProviderCapabilityProbe(provider.kind, provider));
  registry.register(new DerivedCapabilityProbe("secure-messaging", [database, secureCore, enrollment, keyVerification, transparency, relay, realtime]));
  return registry;
}

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import type { CapabilityRegistry } from "../runtime/capabilities.js";

export async function registerRuntimeRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  registry: CapabilityRegistry
) {
  app.get("/v1/runtime/final-readiness", async (_request, reply) => {
    const checks = {
      database: false,
      migrations: false,
      authentication: config.NODE_ENV !== "production" || Boolean(config.JWT_JWKS_URL),
      contactDiscoverySecret: config.CONTACT_DISCOVERY_SECRET.length >= 32,
      tokenVaultKey: config.TOKEN_VAULT_KEY_BASE64.length >= 44,
      smsDelivery: Boolean(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM_NUMBER),
      recoveryEmailDelivery: Boolean(config.EMAIL_DELIVERY_URL && config.EMAIL_DELIVERY_TOKEN && config.EMAIL_FROM),
      objectStorage: Boolean(config.OBJECT_STORAGE_REGION && config.OBJECT_STORAGE_BUCKET && config.OBJECT_STORAGE_KMS_KEY_ID),
      pushDelivery: Boolean(
        config.APNS_TEAM_ID && config.APNS_KEY_ID && config.APNS_PRIVATE_KEY_P8 && config.APNS_BUNDLE_ID &&
        config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL && config.FCM_PRIVATE_KEY
      ),
      billingWebhook: Boolean(config.BILLING_WEBHOOK_SECRET),
      countryDataEncryption: Boolean(config.COUNTRYLINQA_DATA_KEY_V1),
      secureCoreRequired: Boolean(config.SECURE_CORE_ARTIFACT_SHA256),
      releaseIdentified: Boolean(config.PRODUCTION_RELEASE_ID)
    };

    try {
      await db.query("SELECT 1");
      checks.database = true;
      const migrations = await db.query(
        `SELECT EXISTS (
           SELECT 1 FROM schema_migrations
           WHERE version = '024_production_gap_closure.sql'
         ) AS present`
      );
      checks.migrations = migrations.rows[0]?.present === true;
    } catch {
      // The response below exposes only boolean readiness, never DB details.
    }

    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({
      ready,
      checks,
      generatedAt: new Date().toISOString()
    });
  });

  app.get("/v1/runtime/capabilities", async (_request, reply) => {
    try {
      const capabilities = await registry.snapshot();
      return {
        serverVersion: process.env.npm_package_version ?? "development",
        ready: Object.values(capabilities).every((value) => value.state === "READY"),
        capabilities,
        generatedAt: new Date().toISOString()
      };
    } catch {
      return reply.code(503).send({
        ready: false,
        capabilities: {},
        generatedAt: new Date().toISOString()
      });
    }
  });
}

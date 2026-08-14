import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { buildApp } from "../app.js";
import Fastify from "fastify";
import { registerMobileHubRoutes } from "../routes/mobile-hub.js";
import { RealtimeHub } from "../realtime/hub.js";

const config: AppConfig = {
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

const database = {
  query: async (sql: string) => {
    if (sql.includes("schema_migrations")) return { rows: [{ count: 6 }] };
    return { rows: [{ "?column?": 1 }] };
  }
} as unknown as Database;

describe("final runtime bootstrap", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("registers every final route exactly once", async () => {
    app = await buildApp(config, database);
    await app.ready();
    expect(app.hasRoute({ method: "POST", url: "/v1/groups/:groupId/state" })).toBe(true);
    expect(app.hasRoute({
      method: "POST",
      url: "/v1/security/network-risk/evaluate"
    })).toBe(true);
    expect(app.hasRoute({
      method: "GET",
      url: "/v1/security/device-integrity/current"
    })).toBe(true);
    expect(app.hasRoute({
      method: "POST",
      url: "/v1/messages/:messageId/expiry-receipts"
    })).toBe(true);
  });

  it("keeps final readiness closed until the secure core is integrated", async () => {
    app = await buildApp(config, database);
    const response = await app.inject({
      method: "GET",
      url: "/v1/runtime/final-readiness"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().checks.secureCoreRequired).toBe(false);
  });

  it("does not register the development mobile hub in production", async () => {
    app = Fastify();
    await registerMobileHubRoutes(
      app,
      { ...config, NODE_ENV: "production" },
      database,
      new RealtimeHub()
    );
    await app.ready();

    expect(app.hasRoute({ method: "GET", url: "/v1/dev/mobile-hub" })).toBe(false);
    expect(app.hasRoute({ method: "GET", url: "/v1/dev/mobile-hub/live" })).toBe(false);
  });
});
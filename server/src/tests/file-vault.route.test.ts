import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { buildApp } from "../app.js";
import { issueAccessToken } from "../auth/tokens.js";

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

describe("file vault routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("are registered on the booted app", async () => {
    app = await buildApp(config, database);
    await app.ready();

    expect(app.hasRoute({ method: "POST", url: "/v1/vault/items" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v1/vault/items" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v1/vault/items/:itemId/download" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v1/vault/plans" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v1/vault/folders" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/folders" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/imports/social" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v1/vault/imports/:id/status" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/imports/:id/confirm" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v1/vault/files" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/imports/:kind" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/imports/:id/handoff" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/imports/:id/ciphertext-upload" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/imports/:id/finalize-ciphertext" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/share/linqa-user" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/share/vault-to-vault" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/share/secure-links" })).toBe(true);
    expect(app.hasRoute({ method: "DELETE", url: "/v1/vault/share/secure-links/:id" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/share/email" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v1/vault/share/links/:token" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v1/vault/share/transfers/incoming" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/share/transfers/:id/respond" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/exports/social/authorize" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/exports/social/:grantId/execute" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/private/unlock" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/private/lock" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/v1/vault/security-center" })).toBe(true);
    expect(app.hasRoute({ method: "PUT", url: "/v1/vault/security-center/login-alerts" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/billing/checkout" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/vault/billing/webhook" })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: "/internal/ready/vault" })).toBe(true);
  });

  it("vault gap routes reject callers with no token", async () => {
    app = await buildApp(config, database);
    for (const [method, url] of [["GET", "/v1/vault/files"], ["POST", "/v1/vault/share/secure-links"], ["GET", "/v1/vault/security-center"], ["POST", "/v1/vault/billing/checkout"], ["POST", "/v1/vault/imports/message"]] as const) {
      const response = await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("the billing webhook takes the raw body and fails closed with no billing provider", async () => {
    app = await buildApp(config, database);
    const response = await app.inject({ method: "POST", url: "/v1/vault/billing/webhook", headers: { "content-type": "application/json", "x-provider-signature": "x" }, payload: JSON.stringify({ id: "evt_1" }) });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "BILLING_NOT_CONFIGURED" });
  });

  it("fail closed on upload when object storage is not configured", async () => {
    app = await buildApp(config, database);

    const token = await issueAccessToken(config, {
      userId: "user-1",
      subject: "user-1",
      scopes: [],
      sessionId: "session-1"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/vault/items",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        itemType: "DOCUMENT",
        nameCiphertextBase64: Buffer.alloc(16, 1).toString("base64"),
        metadataCiphertextBase64: Buffer.alloc(16, 2).toString("base64"),
        keyEnvelopeBase64: Buffer.alloc(32, 3).toString("base64"),
        contentHashBase64: Buffer.alloc(32, 4).toString("base64"),
        encryptedSize: 1024,
        contentType: "application/octet-stream"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects unauthenticated listing", async () => {
    app = await buildApp(config, database);

    const response = await app.inject({ method: "GET", url: "/v1/vault/items" });
    expect(response.statusCode).toBe(400);
  });
});

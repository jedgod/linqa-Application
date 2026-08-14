import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { buildApp } from "../app.js";

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
  query: async (sql: string) => sql.includes("schema_migrations")
    ? { rows: [{ count: 22 }] }
    : { rows: [], rowCount: 0 }
} as unknown as Database;

describe("Vertical 2 routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => app?.close());

  it("mounts every three-account workflow", async () => {
    app = await buildApp(config, database);
    await app.ready();

    const routes: Array<[string, string]> = [
      ["POST", "/v2/contacts/invites"],
      ["POST", "/v2/contacts/invites/:inviteId/resolve"],
      ["POST", "/v2/communities"],
      ["POST", "/v2/communities/:communityId/join"],
      ["POST", "/v2/calendar/events"],
      ["POST", "/v2/notes"],
      ["POST", "/v2/calls/:callId/screen-share"],
      ["POST", "/v2/screen-share/:sessionId/consent"],
      ["POST", "/v2/ai/jobs"],
      ["GET", "/v2/wallet"],
      ["POST", "/v2/wallet"],
      ["GET", "/v2/entitlements"],
      ["POST", "/v2/enterprise/organizations"],
      ["POST", "/v2/emergency/events"]
    ];

    for (const [method, url] of routes) {
      expect(app.hasRoute({ method, url })).toBe(true);
    }
  });
});
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
  query: async (sql: string) => {
    if (sql.includes("schema_migrations")) return { rows: [{ count: 6 }] };
    return { rows: [{ "?column?": 1 }] };
  }
} as unknown as Database;

/**
 * routes/enrollment-v2.ts was reconciled away on 2026-08-07: it was one of
 * three independent, all-registered device-enrollment mechanisms found in
 * the same diagnostic pass, and its approval endpoint always failed closed
 * (no proof verifier was ever wired in). Device enrollment now happens
 * exclusively through routes/enrollment.ts, which has a real Ed25519
 * verifier (see enrollment.route.test.ts). This file stays on disk, dormant
 * and unregistered, rather than being deleted. See docs/reference/assessments/claudeassess.txt,
 * "TODAY ASSESS TXT".
 */
describe("enrollment v2 routes (deregistered)", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("are not mounted on the booted app", async () => {
    app = await buildApp(config, database);
    await app.ready();

    expect(
      app.hasRoute({ method: "POST", url: "/v1/devices/enrollment/v2/challenges" })
    ).toBe(false);
    expect(
      app.hasRoute({
        method: "POST",
        url: "/v1/devices/enrollment/v2/challenges/:challengeId/approve"
      })
    ).toBe(false);
  });
});

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
    if (sql.includes("FROM webauthn_credentials")) return { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO webauthn_challenges")) return { rows: [], rowCount: 1 };
    return { rows: [{ "?column?": 1 }] };
  }
} as unknown as Database;

describe("passkey routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("are registered on the booted app", async () => {
    app = await buildApp(config, database);
    await app.ready();

    expect(app.hasRoute({ method: "POST", url: "/v1/passkeys/registration/begin" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/passkeys/registration/finish" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/passkeys/authentication/begin" })).toBe(true);
    expect(app.hasRoute({ method: "POST", url: "/v1/passkeys/authentication/finish" })).toBe(true);
  });

  it("issues real WebAuthn registration options for an authenticated caller", async () => {
    app = await buildApp(config, database);

    const token = await issueAccessToken(config, {
      userId: "user-1",
      subject: "user-1",
      scopes: [],
      sessionId: "session-1"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/passkeys/registration/begin",
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: "Alice" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rp).toEqual({ id: config.PASSKEY_RP_ID, name: config.PASSKEY_RP_NAME });
  });

  it("rejects unauthenticated requests", async () => {
    app = await buildApp(config, database);

    const response = await app.inject({
      method: "POST",
      url: "/v1/passkeys/registration/begin",
      payload: { displayName: "Alice" }
    });

    expect(response.statusCode).toBe(400);
  });
});

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

const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";

function buildDatabase(): Database {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("schema_migrations")) return { rows: [{ count: 6 }] };
      if (sql.includes("FROM organization_api_grants")) {
        const organizationId = params?.[0];
        if (organizationId === ORG_A) {
          return { rows: [{ scopes: ["scim:write"] }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO scim_directory_users")) {
        return {
          rows: [{
            id: "scim-user-1",
            user_name: (params as unknown[])[2],
            active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }],
          rowCount: 1
        };
      }
      return { rows: [{ "?column?": 1 }] };
    }
  } as unknown as Database;
}

describe("SCIM route organization authorization", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("provisions a user into an organization the caller is granted for", async () => {
    app = await buildApp(config, buildDatabase());

    const token = await issueAccessToken(config, {
      userId: "user-1",
      subject: "scim-client",
      scopes: ["scim:write"],
      sessionId: "session-1"
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/scim/v2/organizations/${ORG_A}/Users`,
      headers: { authorization: `Bearer ${token}` },
      payload: { userName: "alice@example.com" }
    });

    expect(response.statusCode).toBe(201);
  });

  it("rejects provisioning into an organization the caller has no grant for", async () => {
    app = await buildApp(config, buildDatabase());

    const token = await issueAccessToken(config, {
      userId: "user-1",
      subject: "scim-client",
      scopes: ["scim:write"],
      sessionId: "session-1"
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/scim/v2/organizations/${ORG_B}/Users`,
      headers: { authorization: `Bearer ${token}` },
      payload: { userName: "mallory@example.com" }
    });

    expect(response.statusCode).toBe(403);
  });
});

function buildPolicyDatabase(): Database {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("schema_migrations")) return { rows: [{ count: 6 }] };
      if (sql.includes("FROM organization_api_grants")) {
        const organizationId = params?.[0];
        if (organizationId === ORG_A) {
          return { rows: [{ scopes: ["enterprise:policy:write"] }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO enterprise_policies")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [{ "?column?": 1 }] };
    }
  } as unknown as Database;
}

describe("enterprise policy route organization authorization", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("updates a policy for an organization the caller is granted for", async () => {
    app = await buildApp(config, buildPolicyDatabase());

    const token = await issueAccessToken(config, {
      userId: "user-1",
      subject: "policy-client",
      scopes: ["enterprise:policy:write"],
      sessionId: "session-1"
    });

    const response = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${ORG_A}/policies/dlp`,
      headers: { authorization: `Bearer ${token}` },
      payload: { value: { enabled: true } }
    });

    expect(response.statusCode).toBe(204);
  });

  it("rejects updating a policy for an organization the caller has no grant for", async () => {
    app = await buildApp(config, buildPolicyDatabase());

    const token = await issueAccessToken(config, {
      userId: "user-1",
      subject: "policy-client",
      scopes: ["enterprise:policy:write"],
      sessionId: "session-1"
    });

    const response = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${ORG_B}/policies/dlp`,
      headers: { authorization: `Bearer ${token}` },
      payload: { value: { enabled: true } }
    });

    expect(response.statusCode).toBe(403);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { buildApp } from "../app.js";

const config: AppConfig = {
  NODE_ENV: "test", HOST: "127.0.0.1", PORT: 8080, DATABASE_URL: "postgresql://unused",
  JWT_ISSUER: "https://test.linqa.local", JWT_AUDIENCE: "linqa-api", JWT_HS256_SECRET: "test-secret-that-is-at-least-32-bytes-long",
  CONTACT_DISCOVERY_SECRET: "test-contact-discovery-secret-value", TOKEN_VAULT_KEY_BASE64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  TURN_SHARED_SECRET: "test-turn-secret-that-is-at-least-32-bytes", TURN_URLS: ["turn:127.0.0.1:3478?transport=udp"], CORS_ORIGINS: ["http://127.0.0.1:5173"],
  DEVICE_CHALLENGE_TTL_SECONDS: 300, ENVELOPE_TTL_SECONDS: 2_592_000, MAX_ENVELOPE_BYTES: 262_144, DELIVERY_LEASE_SECONDS: 60,
  PASSKEY_RP_ID: "test.linqa.local", PASSKEY_RP_NAME: "Linqa Test", PASSKEY_ORIGINS: ["https://test.linqa.local"], APNS_SANDBOX: false,
  BILLING_WEBHOOK_TOLERANCE_SECONDS: 300, LINQASEND_WEBHOOK_TOLERANCE_SECONDS: 300, COUNTRY_SELECTION_PREMIUM_LIMIT: 20, LOG_LEVEL: "fatal"
};
const database = { query: async (sql: string) => sql.includes("schema_migrations") ? { rows: [{ count: 36 }] } : { rows: [], rowCount: 0 } } as unknown as Database;

describe("CountryLinqa engine routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => app?.close());

  it("mounts the discovery engine surface", async () => {
    app = await buildApp(config, database); await app.ready();
    for (const [method, url] of [
      ["POST", "/v1/countrylinqa/discover/people/search"], ["GET", "/v1/countrylinqa/search"],
      ["GET", "/v1/countrylinqa/recommendations/people"], ["GET", "/v1/countrylinqa/discovery/features"],
      ["PUT", "/v1/countrylinqa/discovery/features"], ["PATCH", "/v1/countrylinqa/saved-searches/:id/alerts"]
    ] as const) expect(app.hasRoute({ method, url }), `${method} ${url}`).toBe(true);
  });

  it("rejects unauthenticated requests without leaking results", async () => {
    app = await buildApp(config, database); await app.ready();
    const response = await app.inject({ method: "POST", url: "/v1/countrylinqa/discover/people/search", payload: { filters: { countries: ["GH"] } } });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.json()).not.toHaveProperty("items");
  });
});

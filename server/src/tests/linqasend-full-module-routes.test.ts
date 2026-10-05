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

describe("LinqaSend full module surface", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => app?.close());

  it("mounts the API surface required by the full UI/backend pack", async () => {
    app = await buildApp(config, database); await app.ready();
    const routes: Array<[string,string]> = [
      ["GET","/v1/linqasend/availability"], ["GET","/v1/linqasend/home"], ["POST","/v1/linqasend/recipients/resolve/linqa"], ["POST","/v1/linqasend/recipients/resolve/external"],
      ["POST","/v1/linqasend/external-recipients"], ["PATCH","/v1/linqasend/external-recipients/:id"], ["POST","/v1/linqasend/payment-methods/setup"], ["POST","/v1/linqasend/payment-methods/confirm"], ["DELETE","/v1/linqasend/payment-methods/:id"],
      ["GET","/v1/linqasend/receive-profile"], ["POST","/v1/linqasend/requests"], ["GET","/v1/linqasend/requests"],
      ["POST","/v1/linqasend/requests/:id/pay"], ["POST","/v1/linqasend/requests/:id/decline"], ["GET","/v1/linqasend/limits"],
      ["GET","/v1/linqasend/settings"], ["PATCH","/v1/linqasend/settings"], ["POST","/v1/linqasend/transfers/:id/cancel"], ["POST","/v1/linqasend/transfers/:id/refund"]
    ];
    for (const [method,url] of routes) expect(app.hasRoute({ method, url })).toBe(true);
  });

  it("rejects unauthenticated reads of LinqaSend availability", async () => {
    app = await buildApp(config, database); await app.ready();
    const response = await app.inject({ method: "GET", url: "/v1/linqasend/availability" });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(response.json()).not.toHaveProperty("available");
  });
});

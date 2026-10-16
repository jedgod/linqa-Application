import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { SignJWT } from "jose";
import { loadConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { PaymentIntentService } from "../services/linqasend/payment-intent.service.js";
import { registerLinqaSendRoutes } from "../routes/linqasend/routes.js";
import { convertMinor, parseRateToScaled } from "../services/linqasend/money.js";

describe("persistent payment identity", () => {
  it("reuses one durable key across service instances and concurrent requests", async () => {
    let key: unknown;
    const db = { query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("FROM linqasend_transfers")) return { rows: [] };
      if (sql.includes("FROM linqasend_quotes")) return { rows: [{ id: "quote" }] };
      if (sql.startsWith("INSERT")) { key ??= values?.[2]; return { rows: [] }; }
      return { rows: [{ idempotency_key: key }] };
    }) } as unknown as Database;
    const results = await Promise.all([new PaymentIntentService(db).resolve("user", "quote"), new PaymentIntentService(db).resolve("user", "quote")]);
    expect(results[0]?.idempotencyKey).toBe(results[1]?.idempotencyKey);
    expect(results[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("recovers an accepted transfer without requiring an unexpired quote", async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ public_id: "accepted", status: "QUEUED", idempotency_key: "existing" }] })) } as unknown as Database;
    expect((await new PaymentIntentService(db).resolve("user", "expired")).transferId).toBe("accepted");
    expect(db.query).toHaveBeenCalledTimes(1);
  });
  it("rejects expired or foreign quotes before inserting an intent", async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Database;
    await expect(new PaymentIntentService(db).resolve("user", "foreign")).rejects.toThrow("QUOTE_EXPIRED_OR_NOT_OWNED");
    expect(db.query).toHaveBeenCalledTimes(2);
  });
  it("converts currency minor units across zero, two and three decimal currencies", () => {
    expect(convertMinor(100n, parseRateToScaled("150"), 2, 0)).toBe(150n);
    expect(convertMinor(100n, parseRateToScaled("0.307"), 2, 3)).toBe(307n);
    expect(convertMinor(1000n, parseRateToScaled("1"), 3, 2)).toBe(100n);
  });
});

describe("money route revocation", () => {
  it("rejects revoked devices and sessions in all three route families", async () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused", JWT_ISSUER: "https://test.linqa.local", JWT_AUDIENCE: "test", JWT_HS256_SECRET: "x".repeat(32), CONTACT_DISCOVERY_SECRET: "c".repeat(32), TOKEN_VAULT_KEY_BASE64: "A".repeat(44), TURN_SHARED_SECRET: "t".repeat(32) });
    for (const revoked of ["device", "session"]) {
      const db = { query: async (sql: string) => ({ rows: [], rowCount: sql.includes("SELECT 1 FROM devices") && revoked === "session" ? 1 : 0 }) } as unknown as Database;
      const app = Fastify();
      await registerLinqaSendRoutes(app, config, db);
      const token = await new SignJWT({ user_id: "u", device_id: "d", sid: "s", scope: "linqasend:read linqasend:write" }).setSubject("u").setProtectedHeader({ alg: "HS256" }).setIssuer("https://test.linqa.local").setAudience("test").setExpirationTime("5m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
      for (const url of ["/v1/linqasend/payment-methods", "/v1/linqasend/jurisdiction", "/v1/linqasend/home"]) {
        const response = await app.inject({ url, headers: { authorization: `Bearer ${token}` } });
        expect(response.statusCode).toBe(401);
      }
      await app.close();
    }
  });
});

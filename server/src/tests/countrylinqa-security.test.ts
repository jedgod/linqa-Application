import { describe, expect, it, vi } from "vitest";
import type { Database } from "../db/pool.js";
import { evaluateCountryRisk } from "../services/countrylinqa/risk.js";
import { publicCountryError } from "../routes/countrylinqa/public-error.js";
import { CountryLinqaService } from "../services/countrylinqa/service.js";
import { consumeQuota } from "../routes/countrylinqa/shared-security.js";
import { registerCountrySecurity } from "../routes/countrylinqa/shared-security.js";
import Fastify from "fastify";
import { issueAccessToken } from "../auth/tokens.js";
import type { AppConfig } from "../config.js";
import { validateFilters } from "../services/countrylinqa/engine/filters.js";
import { decodeCursor } from "../services/countrylinqa/engine/cursor.js";

describe("CountryLinqa security regressions", () => {
  it("IP rotation cannot bypass the five-per-hour country confirmation limit", async () => {
    const counts = new Map<string, number>();
    const db = { query: async (_sql: string, params: unknown[]) => {
      const key = String(params[0]); const count = (counts.get(key) ?? 0) + 1; counts.set(key, count);
      return { rows: [{ count }] };
    } } as unknown as Database;
    const config = { NODE_ENV: "test", JWT_HS256_SECRET: "security-test-secret-at-least-32-bytes", JWT_ISSUER: "test", JWT_AUDIENCE: "test" } as AppConfig;
    const app = Fastify(); registerCountrySecurity(app, config, db);
    app.post("/v1/countrylinqa/verification/confirm-country", async () => ({ accepted: true }));
    const token = await issueAccessToken(config, { userId: "123", subject: "test", sessionId: "test", scopes: ["countrylinqa:write"] });
    try {
      for (let i = 0; i < 6; i++) {
        const response = await app.inject({ method: "POST", url: "/v1/countrylinqa/verification/confirm-country", remoteAddress: `192.0.2.${i + 1}`, headers: { authorization: `Bearer ${token}` } });
        expect(response.statusCode).toBe(i < 5 ? 200 : 429);
      }
    } finally { await app.close(); }
  });
  it("client claims, SIM and locale cannot change an authorization decision", () => {
    const trusted = { phoneCountryCode: "US", carrierCountryCode: "CA", phoneVerified: true, lineType: "MOBILE" };
    expect(evaluateCountryRisk({ ...trusted, claimedCountryCode: "GH", simCountryCode: "GH", localeCountryCode: "GH" }))
      .toEqual(evaluateCountryRisk({ ...trusted, claimedCountryCode: "US" }));
    expect(evaluateCountryRisk({ phoneVerified: true, phoneCountryCode: null }).state).not.toBe("VERIFIED");
  });
  it.each(["REVIEW_REQUIRED", "RESTRICTED"])("a %s user cannot clear review by resubmitting", async state => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ verified_country_code: "US", country_verification_state: state }] }) };
    const evidence = { getEvidenceForUser: vi.fn() };
    const service = new CountryLinqaService(db as unknown as Database, {} as never, {} as never, evidence as never, {} as never);
    await expect(service.confirmCountry("user", { claimedCountryCode: "US" }, "127.0.0.1")).rejects.toMatchObject({ status: 403, code: "COUNTRY_REVIEW_REQUIRED" });
    expect(evidence.getEvidenceForUser).not.toHaveBeenCalled();
  });
  it("rechecks review state under the lock after evidence collection", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ country_verification_state: "REVIEW_REQUIRED" }], rowCount: 1 }));
    const client = { query, release: vi.fn() };
    const db = {
      query: vi.fn().mockResolvedValue({ rows: [{ country_verification_state: "UNVERIFIED", verified_country_code: null }], rowCount: 1 }),
      connect: vi.fn().mockResolvedValue(client)
    };
    const service = new CountryLinqaService(db as unknown as Database, {} as never, {} as never,
      { getEvidenceForUser: async () => ({ phoneCountryCode: "US", phoneVerified: true }) },
      { resolveCountry: async () => "US" });
    await expect(service.confirmCountry("user", { claimedCountryCode: "US" }, "127.0.0.1")).rejects.toMatchObject({ status: 403 });
    expect(query.mock.calls.map(call => String(call[0])).join(" ")).not.toMatch(/INSERT INTO country_verification_evidence|UPDATE users/);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });
  it("does not expose database or arbitrary error codes/statuses", () => {
    expect(publicCountryError({ code: "42P08", status: 400 })).toEqual({ status: 500, code: "internal_error" });
    expect(publicCountryError({ code: "secret_schema", status: 403 })).toEqual({ status: 500, code: "internal_error" });
    expect(publicCountryError({ code: "FORBIDDEN", status: 403 })).toEqual({ status: 403, code: "FORBIDDEN" });
  });
  it("preserves deliberate filter and cursor validation responses", () => {
    try { validateFilters({ scope: "GLOBAL" }); throw new Error("Expected filter rejection"); }
    catch (error) { expect(publicCountryError(error)).toEqual({ status: 422, code: "UNKNOWN_FILTER" }); }
    try { decodeCursor(Buffer.from("test"), "tampered", { pv: 1, fh: "test" }); throw new Error("Expected cursor rejection"); }
    catch (error) { expect(publicCountryError(error)).toEqual({ status: 400, code: "INVALID_CURSOR" }); }
  });
  it("uses the same shared quota across independently created callers", async () => {
    let count = 0;
    const db = { query: vi.fn(async () => ({ rows: [{ count: ++count }] })) } as unknown as Database;
    await consumeQuota(db, "user:123:write", 60_000, 1);
    await expect(consumeQuota(db, "user:123:write", 60_000, 1)).rejects.toMatchObject({ status: 429 });
    expect((db.query as any).mock.calls[0][1][0]).toBe((db.query as any).mock.calls[1][1][0]);
  });
});

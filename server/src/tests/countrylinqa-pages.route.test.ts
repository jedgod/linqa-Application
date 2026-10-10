import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { issueAccessToken } from "../auth/tokens.js";
import { registerCountryLinqaRoutes } from "../routes/countrylinqa/routes.js";
import { registerCountryLinqaFinalRoutes } from "../routes/countrylinqa/final-routes.js";
import { registerCountryLinqaGoLiveRoutes } from "../routes/countrylinqa/golive-routes.js";
import type { CountryLinqaService } from "../services/countrylinqa/service.js";
import { discoverySearchSchema } from "../services/countrylinqa/search.js";

const config = { NODE_ENV: "test", JWT_HS256_SECRET: "countrylinqa-test-secret-at-least-32-bytes", JWT_ISSUER: "linqa-test", JWT_AUDIENCE: "linqa-test" } as AppConfig;
const userId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";

describe("CountryLinqa page API contracts", () => {
  let app: FastifyInstance;
  const query = vi.fn();
  const queryCall = (index: number) => {
    const call = query.mock.calls[index];
    expect(call).toBeDefined();
    return call!;
  };
  let headers: { authorization: string };
  beforeEach(async () => {
    query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    app = Fastify(); const db = { query, connect: async () => ({ release: () => {}, query: async (sql: string, params?: unknown[]) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM users WHERE id=$1 FOR UPDATE")) return { rows: [{ id: userId }], rowCount: 1 };
      if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: 0 }], rowCount: 1 };
      return query(sql, params);
    } }) } as unknown as Database;
    await registerCountryLinqaRoutes(app, config, db, {} as CountryLinqaService);
    await registerCountryLinqaFinalRoutes(app, config, db);
    await registerCountryLinqaGoLiveRoutes(app, config, db);
    headers = { authorization: `Bearer ${await issueAccessToken(config, { userId, subject: "test-user", sessionId: "test-session", scopes: ["countrylinqa:read", "countrylinqa:write"] })}` };
  });
  afterEach(async () => { await app.close(); });

  it("parses explicit false values and rejects unsupported online discovery", async () => {
    expect(discoverySearchSchema.parse({ verifiedOnly: "false", onlineOnly: "false" })).toMatchObject({ verifiedOnly: false, onlineOnly: false });
    const response = await app.inject({ url: "/v1/countrylinqa/discover/users?onlineOnly=true", headers });
    expect(response.statusCode).toBe(422); expect(query).not.toHaveBeenCalled();
  });
  it("rejects invalid filter booleans and unknown discovery filters", async () => {
    for (const suffix of ["verifiedOnly=no", "profession=engineer"]) {
      const response = await app.inject({ url: `/v1/countrylinqa/discover/users?${suffix}`, headers });
      expect(response.statusCode).toBe(422);
    }
    expect(query).not.toHaveBeenCalled();
  });
  it("returns a people cursor only when an extra result exists", async () => {
    query.mockResolvedValue({ rows: [{ id: userId }, { id: otherId }, { id: "third" }], rowCount: 3 });
    const response = await app.inject({ url: "/v1/countrylinqa/discover/users?limit=2&country=us", headers });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ items: [{ id: userId }, { id: otherId }], nextCursor: otherId });
    expect(queryCall(0)[1]).toEqual([userId, "US", 3]);
    query.mockResolvedValue({ rows: [{ id: userId }, { id: otherId }], rowCount: 2 });
    const last = await app.inject({ url: "/v1/countrylinqa/discover/users?limit=2", headers });
    expect(last.json().nextCursor).toBeNull();
  });
  it("stores supported search filters for the authenticated owner", async () => {
    query.mockResolvedValue({ rows: [{ id: otherId, name: "People in USA" }], rowCount: 1 });
    const response = await app.inject({ method: "POST", url: "/v1/countrylinqa/saved-searches", headers, payload: { name: "People in USA", userId: otherId, filters: { q: "Ada", country: "us", verifiedOnly: false } } });
    expect(response.statusCode).toBe(201);
    expect(queryCall(0)[1]).toEqual([userId, "People in USA", JSON.stringify({ q: "Ada", country: "US", verifiedOnly: false })]);
  });
  it("does not silently save filters the discovery API cannot execute", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/countrylinqa/saved-searches", headers, payload: { name: "Unsupported", filters: { relationshipIntent: "friends" } } });
    expect(response.statusCode).toBe(422); expect(query).not.toHaveBeenCalled();
  });
  it("deletes saved searches only inside the caller's account", async () => {
    const response = await app.inject({ method: "DELETE", url: `/v1/countrylinqa/saved-searches/${otherId}`, headers });
    expect(response.statusCode).toBe(200); expect(queryCall(0)[1]).toEqual([otherId,userId]);
  });
  it("cannot restore a suspended community membership", async () => {
    query.mockResolvedValueOnce({ rows: [{ allowed: true }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const response = await app.inject({ method: "POST", url: "/v1/countrylinqa/communities/country/US/join", headers });
    expect(response.statusCode).toBe(403); expect(response.json().error).toBe("COMMUNITY_MEMBERSHIP_SUSPENDED");
    expect(queryCall(1)[0]).toContain("status <> 'SUSPENDED'");
  });
  it("requires country verification before publishing", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/countrylinqa/golive/posts", headers, payload: { body: "Hello world" } });
    expect(response.statusCode).toBe(403); expect(response.json().error).toBe("COUNTRY_PUBLISHING_UNAVAILABLE");
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("publishes a verified post using server country evidence", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: otherId, body: "Hello", countryCode: "US" }], rowCount: 1 });
    const response = await app.inject({ method: "POST", url: "/v1/countrylinqa/golive/posts", headers, payload: { body: "Hello", countryCode: "GB" } });
    expect(response.statusCode).toBe(201); expect(response.json().countryCode).toBe("US");
    expect(queryCall(0)[1]).toEqual([userId,"Hello"]);
    expect(queryCall(0)[0]).toContain("u.country_verification_state='VERIFIED'");
  });
  it("rejects past events without inserting content", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/countrylinqa/golive/events", headers, payload: { title: "Past event", startsAt: "2020-01-01T00:00:00Z" } });
    expect(response.statusCode).toBe(422); expect(query).not.toHaveBeenCalled();
  });
  it("does not paginate feed posts by UUID when sorted by time", async () => {
    query.mockResolvedValue({ rows: [{ id: otherId, body: "new" }, { id: userId, body: "older" }], rowCount: 2 });
    const response = await app.inject({ url: `/v1/countrylinqa/golive/feed?limit=1&cursor=${otherId}`, headers });
    expect(response.json()).toEqual({ items: [{ id: otherId, body: "new" }], nextCursor: otherId });
    expect(queryCall(0)[0]).toContain("(p.created_at, p.id) <");
    expect(queryCall(0)[0]).toContain("ORDER BY p.created_at DESC, p.id DESC");
  });
  it("pages event results and applies country, date and safety controls", async () => {
    query.mockResolvedValue({ rows: [{ id: "a" }, { id: "b" }], rowCount: 2 });
    const response = await app.inject({ url: "/v1/countrylinqa/golive/events?limit=1&offset=4&country=us&period=week", headers });
    expect(response.json()).toEqual({ items: [{ id: "a" }], nextOffset: 5 });
    const [sql,params] = queryCall(0);
    expect(params).toEqual([userId,"US",2,4]);
    expect(sql).toContain("vs.selected_countries"); expect(sql).toContain("country_inbound_links"); expect(sql).toContain("blocked_users"); expect(sql).toContain("interval '7 days'");
  });
  it("restricts connection decisions to the correct sender or recipient", async () => {
    const response = await app.inject({ method: "POST", url: `/v1/countrylinqa/connections/${otherId}/resolve`, headers, payload: { action: "ACCEPT" } });
    expect(response.statusCode).toBe(404);
    expect(queryCall(0)[1]).toEqual([userId,otherId,"ACCEPTED","ACCEPT"]);
    expect(queryCall(0)[0]).toContain("cr.recipient_user_id=$1");
  });
  it("reads only the caller's delivered notifications", async () => {
    const response = await app.inject({ url: "/v1/countrylinqa/notifications", headers });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ items: [] });
    expect(queryCall(0)[1]).toEqual([userId]); expect(queryCall(0)[0]).toContain("status='SENT'");
  });
  it("validates and persists all notification preferences under the caller's identity", async () => {
    const prefs = { countryTrends: true, regionalTrends: false, selectedCountryActivity: true, countryEvents: true, countryBusinesses: false, securityAlerts: true, digestFrequency: "WEEKLY" };
    query.mockResolvedValue({ rows: [prefs],rowCount: 1 });
    const response = await app.inject({ method: "PUT",url: "/v1/countrylinqa/notifications/preferences",headers,payload: prefs });
    expect(response.json()).toEqual(prefs); expect(queryCall(0)[1]).toEqual([userId,true,false,true,true,false,true,"WEEKLY"]);
  });
  it("updates the canonical profile without accepting a client-selected identity", async () => {
    query.mockResolvedValue({ rows: [{ id: userId,displayName: "Ada",bio: "Hello" }],rowCount: 1 });
    const response = await app.inject({ method: "PUT",url: "/v1/countrylinqa/profile",headers,payload: { displayName: "Ada",bio: "Hello" } });
    expect(response.statusCode).toBe(200); expect(queryCall(1)[1]).toEqual([userId,"Ada","Hello"]);
    const injected = await app.inject({ method: "PUT",url: "/v1/countrylinqa/profile",headers,payload: { displayName: "Ada",bio: "Hello",userId: otherId } });
    expect(injected.statusCode).toBe(422);
  });
  it("queues reports only for content the caller may discover", async () => {
    query.mockResolvedValueOnce({ rows: [],rowCount: 0 });
    const response = await app.inject({ method: "POST",url: "/v1/countrylinqa/reports",headers,payload: { subjectType: "POST",subjectId: otherId,reason: "SPAM",details: "Spam post" } });
    expect(response.statusCode).toBe(404);
    expect(queryCall(0)[0]).toContain("country_inbound_links"); expect(queryCall(0)[0]).toContain("blocked_users");
    expect(JSON.parse(queryCall(0)[1][4]).reporterUserId).toBe(userId);
  });
  it("rejects missing authorization and missing scopes before database access", async () => {
    const noToken = await app.inject({ url: "/v1/countrylinqa/connections" }); expect(noToken.statusCode).toBeGreaterThanOrEqual(400);
    const token = await issueAccessToken(config, { userId,subject: "test-user",sessionId: "test-session",scopes: [] });
    const noScope = await app.inject({ url: "/v1/countrylinqa/connections", headers: { authorization: `Bearer ${token}` } }); expect(noScope.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});

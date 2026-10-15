import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { SignJWT } from "jose";
import { eventInput, looksLike, registerPublishingRoutes, uploadInput } from "../routes/publishing.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";

const user = "11111111-1111-4111-8111-111111111111";
const config = { NODE_ENV: "test", JWT_ISSUER: "pub", JWT_AUDIENCE: "pub", JWT_HS256_SECRET: "publishing-test-secret-32-characters!!" } as AppConfig;
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((a) => a.close())); });

async function fixture(scope = "countrylinqa:read countrylinqa:write") {
  const app = Fastify(); apps.push(app);
  const query = vi.fn(async (sql: string) => sql.includes("FROM devices") ? { rows: [], rowCount: 1 } : { rows: [], rowCount: 0 });
  await registerPublishingRoutes(app, config, { query, connect: vi.fn() } as unknown as Database);
  const token = await new SignJWT({ user_id: user, device_id: "d1", scope }).setProtectedHeader({ alg: "HS256" }).setSubject(user).setIssuer("pub").setAudience("pub").setExpirationTime("5m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  return { app, query, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
}

describe("publishing validation (the supplied pack's rules)", () => {
  const base = { title: "Hello", startsAt: "2030-01-01T10:00:00Z", timezone: "UTC" };
  it("accepts a minimal event and defaults the rest", () => {
    const parsed = eventInput.parse(base);
    expect(parsed).toMatchObject({ description: "", location: "", visibility: "public", uploadIds: [] });
  });
  it.each([
    ["empty title", { ...base, title: "   " }],
    ["title over 200", { ...base, title: "x".repeat(201) }],
    ["bad date", { ...base, startsAt: "tomorrow" }],
    ["end before start", { ...base, endsAt: "2029-01-01T10:00:00Z" }],
    ["latitude out of range", { ...base, coordinates: { latitude: 91, longitude: 0 } }],
    ["unknown field", { ...base, admin: true }],
    ["too many uploads", { ...base, uploadIds: Array.from({ length: 11 }, () => user) }]
  ])("rejects %s", (_name, body) => { expect(eventInput.safeParse(body).success).toBe(false); });
  it("limits upload types and sizes", () => {
    expect(uploadInput.safeParse({ mimeType: "image/jpeg", bytes: 10 }).success).toBe(true);
    expect(uploadInput.safeParse({ mimeType: "application/x-msdownload", bytes: 10 }).success).toBe(false);
    expect(uploadInput.safeParse({ mimeType: "image/png", bytes: 101 * 1024 * 1024 }).success).toBe(false);
  });
  it("checks that bytes look like the declared type", () => {
    expect(looksLike("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(looksLike("image/jpeg", Buffer.from("<script>alert(1)</script>"))).toBe(false);
    expect(looksLike("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe(true);
    expect(looksLike("video/mp4", Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]))).toBe(true);
  });
});

describe("publishing routes", () => {
  it("refuses anonymous and wrong-scope callers before touching the database", async () => {
    const anon = await fixture();
    expect((await anon.app.inject({ url: "/api/publishing/events" })).statusCode).toBe(401);
    expect(anon.query).not.toHaveBeenCalled();
    const scoped = await fixture("profile:read");
    expect((await scoped.app.inject({ url: "/api/publishing/events", headers: scoped.headers })).statusCode).toBe(401);
  });
  it("needs an Idempotency-Key and a valid event to publish", async () => {
    const f = await fixture();
    const body = JSON.stringify({ title: "Hi", startsAt: "2030-01-01T10:00:00Z", timezone: "UTC" });
    expect((await f.app.inject({ method: "POST", url: "/api/publishing/events", headers: f.headers, payload: body })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "POST", url: "/api/publishing/events", headers: { ...f.headers, "idempotency-key": "not-a-uuid" }, payload: body })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "POST", url: "/api/publishing/events", headers: { ...f.headers, "idempotency-key": user }, payload: "{}" })).statusCode).toBe(400);
  });
  it("only shows a person public events and their own", async () => {
    const f = await fixture();
    const response = await f.app.inject({ url: "/api/publishing/events", headers: f.headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const sql = String(f.query.mock.calls.find(([s]) => String(s).includes("FROM publishing_events"))?.[0]);
    expect(sql).toContain("e.creator_id=$1 OR (e.visibility='public' AND e.status='published')");
  });
  it("answers 404 for someone else's private event, cancel and edit", async () => {
    const f = await fixture();
    const id = "22222222-2222-4222-8222-222222222222";
    expect((await f.app.inject({ url: `/api/publishing/events/${id}`, headers: f.headers })).statusCode).toBe(404);
    expect((await f.app.inject({ method: "POST", url: `/api/publishing/events/${id}/cancel`, headers: f.headers })).statusCode).toBe(404);
    expect((await f.app.inject({ method: "PATCH", url: `/api/publishing/events/${id}`, headers: f.headers, payload: JSON.stringify({ title: "x" }) })).statusCode).toBe(404);
  });
});

describe("location belongs to the publisher", () => {
  it("only the publisher's own, still-published event can have its location changed", async () => {
    const f = await fixture();
    const id = "22222222-2222-4222-8222-222222222222";
    await f.app.inject({ method: "PATCH", url: `/api/publishing/events/${id}`, headers: f.headers, payload: JSON.stringify({ location: "Elsewhere", coordinates: { latitude: 1, longitude: 2 } }) });
    const call = f.query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE publishing_events SET"));
    const sql = String(call?.[0]);
    expect(sql).toContain("venue_name=");
    expect(sql).toContain("latitude=");
    // The row is matched on the caller being its creator, so any other person changes nothing and is told "not found".
    expect(sql).toMatch(/creator_id=\$\d+ AND status='published'/);
    expect((call as unknown as [string, unknown[]])?.[1]).toContain(user);
  });
});

describe("tags and GIFs", () => {
  const base = { title: "Hello", startsAt: "2030-01-01T10:00:00Z", timezone: "UTC" };
  it("accepts up to 20 tagged people and refuses more or invalid ids", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(eventInput.safeParse({ ...base, taggedUserIds: ids(20) }).success).toBe(true);
    expect(eventInput.safeParse({ ...base, taggedUserIds: ids(21) }).success).toBe(false);
    expect(eventInput.safeParse({ ...base, taggedUserIds: ["not-a-uuid"] }).success).toBe(false);
  });
  it("accepts a GIF upload only when the bytes are a GIF", () => {
    expect(uploadInput.safeParse({ mimeType: "image/gif", bytes: 10 }).success).toBe(true);
    expect(looksLike("image/gif", Buffer.from("GIF89a000000"))).toBe(true);
    expect(looksLike("image/gif", Buffer.from("AAAAAAAAAAAA"))).toBe(false);
  });
});


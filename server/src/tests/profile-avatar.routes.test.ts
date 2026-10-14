import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { SignJWT } from "jose";
import { registerProfileRoutes } from "../routes/profile.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import type { UsernameService } from "../services/username.service.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function fixture() {
  const app = Fastify(); apps.push(app);
  const id = "11111111-1111-4111-8111-111111111111";
  const config = { NODE_ENV: "test", JWT_HS256_SECRET: "avatar-test-secret", JWT_ISSUER: "test", JWT_AUDIENCE: "test" } as AppConfig;
  const query = vi.fn().mockResolvedValue({ rows: [{ id, normalized_username: "jane", avatar_updated_at: new Date("2026-10-13T12:00:00Z") }], rowCount: 1 });
  await registerProfileRoutes(app, config, { query } as unknown as Database, {} as UsernameService);
  const token = await new SignJWT({ user_id: id, device_id: "device-1" }).setProtectedHeader({ alg: "HS256" }).setSubject(id).setIssuer("test").setAudience("test").setExpirationTime("5m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  return { app, query, headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg" } };
}
describe("Profile avatar uploads", () => {
  it("stores raw image bytes and returns a versioned avatar URL", async () => {
    const { app, query, headers } = await fixture();
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const response = await app.inject({ method: "PUT", url: "/v1/profile/avatar", headers, payload: bytes });
    expect(response.statusCode).toBe(200);
    expect(query.mock.calls[0]?.[1]).toEqual(["11111111-1111-4111-8111-111111111111", "image/jpeg", bytes]);
    expect(response.json().avatarUrl).toMatch(/\/avatar\?v=\d+$/);
  });
  it("refuses a revoked or missing session without writing the image", async () => {
    const { app, query } = await fixture();
    const response = await app.inject({ method: "PUT", url: "/v1/profile/avatar", headers: { "content-type": "image/jpeg" }, payload: Buffer.from([0xff, 0xd8, 0xff]) });
    expect(response.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects invalid bytes even when labelled JPEG", async () => {
    const { app, query, headers } = await fixture();
    expect((await app.inject({ method: "PUT", url: "/v1/profile/avatar", headers, payload: Buffer.from("not an image") })).statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
describe("Profile avatar visibility", () => {
  const other = "22222222-2222-4222-8222-222222222222";
  const image = { mime: "image/jpeg", image: Buffer.from([0xff, 0xd8, 0xff]) };
  async function view(connected: boolean) {
    const f = await fixture();
    f.query.mockImplementation(async (sql: string) => sql.includes("FROM user_avatars") ? { rows: [image], rowCount: 1 } : { rows: [], rowCount: connected ? 1 : 0 });
    const response = await f.app.inject({ url: `/v1/profile/${other}/avatar`, headers: { authorization: f.headers.authorization } });
    return { response, query: f.query };
  }
  it("shows a photo to someone connected through a chat or contact", async () => {
    const { response } = await view(true);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/jpeg");
  });
  it("hides it from strangers and blocked people without reading the image", async () => {
    const { response, query } = await view(false);
    expect(response.statusCode).toBe(404);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("FROM user_avatars"))).toBe(false);
  });
  it("always shows a person their own photo", async () => {
    const f = await fixture();
    f.query.mockResolvedValue({ rows: [image], rowCount: 1 });
    const response = await f.app.inject({ url: "/v1/profile/11111111-1111-4111-8111-111111111111/avatar", headers: { authorization: f.headers.authorization } });
    expect(response.statusCode).toBe(200);
    expect(f.query).toHaveBeenCalledTimes(1);
  });
});

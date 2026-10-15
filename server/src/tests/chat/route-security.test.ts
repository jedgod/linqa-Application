import Fastify from "fastify";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import { registerThreadAttachmentRoutes } from "../../chat/thread-attachment.routes.js";

const config = { JWT_ISSUER: "chat-security-test", JWT_AUDIENCE: "linqa-api", JWT_HS256_SECRET: "chat-security-fixture-secret-at-least-32-bytes" } as AppConfig;
const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const conversation = "00000000-0000-4000-8000-000000000003";
const device = "00000000-0000-4000-8000-000000000004";
const url = `/v2/chats/${conversation}/attachments`;
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function token(options: { userId?: string; scope?: string; issuer?: string; audience?: string; expiry?: string; secret?: string; deviceId?: string; sessionId?: string } = {}) {
  return new SignJWT({ user_id: options.userId ?? user, device_id: options.deviceId, sid: options.sessionId, scope: options.scope ?? "messages:read messages:send" })
    .setProtectedHeader({ alg: "HS256" }).setSubject(options.userId ?? user)
    .setIssuer(options.issuer ?? config.JWT_ISSUER).setAudience(options.audience ?? config.JWT_AUDIENCE)
    .setExpirationTime(options.expiry ?? "5m").sign(new TextEncoder().encode(options.secret ?? config.JWT_HS256_SECRET));
}

// Exercise real route, validation and service authorization with an isolated database adapter.
// SQL semantics and concurrency are covered by the separate PostgreSQL integration suites.
async function fixture(activeDevice = true, member = user, activeSession = true) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM devices")) return { rows: [], rowCount: activeDevice && params?.[0] === device && params?.[1] === user ? 1 : 0 };
    if (sql.includes("FROM auth_sessions")) return { rows: [], rowCount: activeSession ? 1 : 0 };
    if (sql.includes("SELECT cm.role")) return { rows: params?.[1] === member ? [{ role: "MEMBER" }] : [], rowCount: params?.[1] === member ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const db = { query, connect: async () => ({ query, release }) } as unknown as Database;
  const app = Fastify(); apps.push(app);
  await registerThreadAttachmentRoutes(app, config, db); await app.ready();
  return { app, query, revokeSession: () => { activeSession = false; } };
}

describe("chat route security boundaries", () => {
  it("rejects the same access token after its persistent session is revoked", async () => {
    const { app, revokeSession } = await fixture();
    const headers = { authorization: `Bearer ${await token({ deviceId: device, sessionId: conversation })}` };
    expect((await app.inject({ url, headers })).statusCode).toBe(200);
    revokeSession();
    expect((await app.inject({ url, headers })).statusCode).toBe(401);
  });
  it.each([
    ["expired", { expiry: "-1s" }], ["wrong issuer", { issuer: "attacker" }],
    ["wrong audience", { audience: "another-api" }], ["forged signature", { secret: "forged-secret-at-least-thirty-two-bytes" }],
    ["missing scope", { scope: "profile:read" }]
  ] as const)("rejects %s tokens before touching data", async (_label, options) => {
    const { app, query } = await fixture();
    const response = await app.inject({ url, headers: { authorization: `Bearer ${await token(options)}` } });
    expect(response.statusCode).toBe(401); expect(query).not.toHaveBeenCalled();
  });

  it("rejects a revoked device before loading attachments", async () => {
    const { app, query } = await fixture(false);
    const response = await app.inject({ url, headers: { authorization: `Bearer ${await token({ deviceId: device })}` } });
    expect(response.statusCode).toBe(401);
    expect(query.mock.calls.some(([sql]) => sql.includes("FROM thread_attachments"))).toBe(false);
  });

  it("rejects another account's device even with a correctly signed token", async () => {
    const { app, query } = await fixture();
    const response = await app.inject({ url, headers: { authorization: `Bearer ${await token({ userId: other, deviceId: device })}` } });
    expect(response.statusCode).toBe(401);
    expect(query.mock.calls.some(([sql]) => sql.includes("SELECT cm.role"))).toBe(false);
  });

  it("checks the authenticated caller's membership before returning ciphertext", async () => {
    const { app, query } = await fixture();
    const response = await app.inject({ url, headers: { authorization: `Bearer ${await token({ userId: other })}` } });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("CONVERSATION_NOT_FOUND");
    expect(query.mock.calls.some(([sql]) => sql.includes("FROM thread_attachments"))).toBe(false);
  });

  it("does not carry one account's authorization into the next request", async () => {
    const { app } = await fixture();
    expect((await app.inject({ url, headers: { authorization: `Bearer ${await token()}` } })).statusCode).toBe(200);
    expect((await app.inject({ url, headers: { authorization: `Bearer ${await token({ userId: other })}` } })).statusCode).toBe(404);
    expect((await app.inject({ url })).statusCode).toBe(401);
  });

  it.each([{ phone: "+13015550100" }, { fileName: "secret.jpg" }, { mimeType: "image/jpeg" }, { plaintextUrl: "https://example.invalid/private" }, { fileName: "" }])("rejects plaintext attachment fields %j before opening a transaction", async extra => {
    const { app, query } = await fixture();
    const response = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${await token()}` }, payload: {
      id: device, kind: "CONTACT", envelopeBase64: Buffer.alloc(64, 7).toString("base64url"), ...extra
    } });
    expect(response.statusCode).toBe(422); expect(query).not.toHaveBeenCalled();
  });
});

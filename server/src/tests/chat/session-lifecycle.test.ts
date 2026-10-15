import { EventEmitter } from "node:events";
import Fastify, { type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import { SignJWT } from "jose";
import { afterEach, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { AuthPrincipal } from "../../auth/types.js";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import { assertActivePrincipal } from "../../auth/active-principal.js";
import { createAuthenticator } from "../../auth/jwt.js";
import { createSocketSessionGuard } from "../../realtime/session-guard.js";
import { RealtimeHub } from "../../realtime/hub.js";
import { API_CONTENT_SECURITY_POLICY } from "../../security/api-headers.js";
import { SessionService, InvalidRefreshTokenError } from "../../services/session.service.js";

const principal: AuthPrincipal = { subject: "user", userId: "00000000-0000-4000-8000-000000000001", deviceId: "00000000-0000-4000-8000-000000000002", sessionId: "00000000-0000-4000-8000-000000000003", scopes: new Set(["messages:read"]), expiresAt: Math.floor(Date.now() / 1000) + 300 };
function socket() {
  const value = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() });
  value.close.mockImplementation(() => { value.readyState = 3; value.emit("close"); });
  return value;
}
afterEach(() => { vi.useRealTimers(); });

it("binds session authorization to user, device, expiry and permanent revocation", async () => {
  const query = vi.fn(async (sql: string) => ({ rows: [], rowCount: sql.includes("FROM devices") ? 1 : 0 }));
  await expect(assertActivePrincipal({ query }, principal)).rejects.toThrow("SESSION_AUTHENTICATION_REVOKED");
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining("device_id IS NOT DISTINCT FROM $3::uuid"), [principal.sessionId, principal.userId, principal.deviceId]);
  expect(query.mock.calls[1]![0]).toContain("revoked_at IS NULL AND expires_at>now()");
});

it("closes idle sockets after revocation and releases its polling timer", async () => {
  vi.useFakeTimers();
  let active = true;
  const db = { query: async () => ({ rows: [], rowCount: active ? 1 : 0 }) };
  const ws = socket();
  const guard = createSocketSessionGuard(ws as unknown as WebSocket, principal, db);
  expect(await guard.authorize()).toBe(true);
  active = false;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(ws.close).toHaveBeenCalledWith(4003, "authorization no longer valid");
  expect(vi.getTimerCount()).toBe(0);
});

it("fails closed during a database outage and after token expiry", async () => {
  const ws = socket();
  const db = { query: async (): Promise<never> => { throw new Error("database unavailable"); } };
  const guard = createSocketSessionGuard(ws as unknown as WebSocket, principal, db);
  expect(await guard.authorize()).toBe(false);
  expect(ws.close).toHaveBeenCalled();
  const expired = socket();
  const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
  expect(await createSocketSessionGuard(expired as unknown as WebSocket, { ...principal, expiresAt: 1 }, { query }).authorize()).toBe(false);
  expect(query).not.toHaveBeenCalled();
});

it("rechecks outbound authorization, preserves event ordering and bounds slow consumers", async () => {
  const hub = new RealtimeHub(), ws = socket();
  let allowed = true;
  const authorize = vi.fn(async () => allowed);
  hub.add({ socket: ws as unknown as WebSocket, userId: principal.userId, deviceId: principal.deviceId!, authorize });
  hub.sendToUser(principal.userId, { n: 1 }); hub.sendToUser(principal.userId, { n: 2 });
  await vi.waitFor(() => expect(ws.send).toHaveBeenCalledTimes(2));
  expect(ws.send.mock.calls.map(args => JSON.parse(args[0]))).toEqual([{ n: 1 }, { n: 2 }]);
  allowed = false;
  hub.sendToUser(principal.userId, { secret: "must not reach the socket" });
  await vi.waitFor(() => expect(authorize).toHaveBeenCalledTimes(3));
  expect(ws.send).toHaveBeenCalledTimes(2);
  ws.bufferedAmount = 1_048_577;
  hub.sendToUser(principal.userId, { n: 4 });
  expect(ws.close).toHaveBeenCalledWith(4008, "slow consumer");
});

it("does not let an old connection's cleanup remove a replacement device connection", () => {
  const hub = new RealtimeHub(), old = socket(), replacement = socket();
  const remove = hub.add({ socket: old as unknown as WebSocket, userId: principal.userId, deviceId: principal.deviceId! });
  hub.disconnectDevice(principal.deviceId!);
  hub.add({ socket: replacement as unknown as WebSocket, userId: principal.userId, deviceId: principal.deviceId! });
  remove(); hub.notifyEnvelopeAvailable(principal.deviceId!, 1);
  expect(replacement.send).toHaveBeenCalledTimes(1);
});

it("requires exp even when a JWT has a valid signature", async () => {
  const config = { JWT_ISSUER: "expiry-test", JWT_AUDIENCE: "linqa-api", JWT_HS256_SECRET: "expiry-test-only-secret-at-least-32-bytes" } as AppConfig;
  const token = await new SignJWT({ user_id: principal.userId, scope: "messages:read" }).setProtectedHeader({ alg: "HS256" }).setSubject(principal.subject)
    .setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  await expect(createAuthenticator(config)({ headers: { authorization: `Bearer ${token}` } } as FastifyRequest))
    .rejects.toMatchObject({ code: "ERR_JWT_CLAIM_VALIDATION_FAILED", claim: "exp" });
});

it("does not turn a database outage during refresh authorization into invalid credentials", async () => {
  const outage = new Error("database unavailable");
  const row = { id: principal.sessionId, user_id: principal.userId, device_id: principal.deviceId, external_subject: principal.subject,
    expires_at: new Date(Date.now() + 60_000), revoked_at: null, access_scope: ["messages:read"] };
  const client = { query: vi.fn(async (sql: string) => {
    if (sql.includes("SELECT s.*")) return { rows: [row], rowCount: 1 };
    if (sql.includes("FROM devices")) throw outage;
    return { rows: [], rowCount: 0 };
  }), release: vi.fn() };
  const db = { connect: async () => client } as unknown as Database;
  const error = await new SessionService(db, {} as AppConfig).rotate({ refreshToken: "fixture-refresh-token" }).catch(error => error);
  expect(error).toBe(outage); expect(error).not.toBeInstanceOf(InvalidRefreshTokenError);
  expect(client.release).toHaveBeenCalled();
});

it("serves API responses with an explicit non-executable content security policy", async () => {
  const app = Fastify(); await app.register(helmet, { contentSecurityPolicy: API_CONTENT_SECURITY_POLICY });
  app.get("/probe", async () => ({ ok: true }));
  try {
    const response = await app.inject("/probe");
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  } finally { await app.close(); }
});

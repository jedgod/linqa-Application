import Fastify from "fastify";
import { SignJWT } from "jose";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import { registerRealtime } from "../../realtime/register.js";
import { RealtimeHub } from "../../realtime/hub.js";

const config = { JWT_ISSUER: "realtime-security-test", JWT_AUDIENCE: "linqa-api", JWT_HS256_SECRET: "realtime-security-fixture-secret-at-least-32-bytes" } as AppConfig;
const user = "00000000-0000-4000-8000-000000000001";
const device = "00000000-0000-4000-8000-000000000002";
const apps: ReturnType<typeof Fastify>[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => { sockets.splice(0).forEach(socket => socket.terminate()); await Promise.all(apps.splice(0).map(app => app.close())); });

async function token(scope = "messages:read", deviceId: string | undefined = device, expiry = "5m", issuer = config.JWT_ISSUER, audience = config.JWT_AUDIENCE, sessionId?: string) {
  return new SignJWT({ user_id: user, device_id: deviceId, sid: sessionId, scope }).setProtectedHeader({ alg: "HS256" })
    .setSubject(user).setIssuer(issuer).setAudience(audience)
    .setExpirationTime(expiry).sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
}
async function connect(jwt: string, active = true) {
  const app = Fastify(); apps.push(app);
  const query = vi.fn(async () => ({ rows: [], rowCount: active ? 1 : 0 }));
  const hub = new RealtimeHub(); const add = vi.spyOn(hub, "add");
  await registerRealtime(app, config, { query } as unknown as Database, hub);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as { port: number };
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/realtime`, { headers: { authorization: `Bearer ${jwt}` } });
  sockets.push(socket);
  const outcome = new Promise<{ code?: number; message?: unknown }>((resolve, reject) => {
    socket.once("close", code => resolve({ code }));
    socket.once("message", raw => resolve({ message: JSON.parse(raw.toString()) }));
    socket.once("error", reject);
  });
  return { outcome, query, add, socket, hub };
}

it.each(["malformed", "expired", "wrong issuer", "wrong audience", "missing scope", "unbound", "revoked"])("rejects %s realtime authentication", async kind => {
  const jwt = kind === "malformed" ? "invalid-token" : kind === "expired" ? await token("messages:read", device, "-1s")
    : kind === "wrong issuer" ? await token("messages:read", device, "5m", "attacker")
    : kind === "wrong audience" ? await token("messages:read", device, "5m", config.JWT_ISSUER, "another-api")
    : kind === "missing scope" ? await token("profile:read") : kind === "unbound" ? await token("messages:read", "") : await token();
  const { outcome, add } = await connect(jwt, kind !== "revoked");
  expect((await outcome).code).toBe(kind === "revoked" ? 4003 : 4001);
  expect(add).not.toHaveBeenCalled();
});

it("registers an active device only after authenticated scope and revocation checks", async () => {
  const { outcome, query, add } = await connect(await token());
  expect((await outcome).message).toEqual({ type: "ready" });
  expect(query).toHaveBeenCalledWith(expect.stringContaining("revoked_at IS NULL"), [device, user]);
  expect(add).toHaveBeenCalledWith(expect.objectContaining({ userId: user, deviceId: device }));
});

it("closes an established socket instead of delivering events after session revocation", async () => {
  const { outcome, query, socket, hub } = await connect(await token("messages:read", device, "5m", config.JWT_ISSUER, config.JWT_AUDIENCE, "00000000-0000-4000-8000-000000000003"));
  expect((await outcome).message).toEqual({ type: "ready" });
  const received: string[] = []; socket.on("message", raw => received.push(raw.toString()));
  query.mockImplementation(async (sql?: string) => ({ rows: [], rowCount: sql?.includes("auth_sessions") ? 0 : 1 }));
  const closed = new Promise<number>(resolve => socket.once("close", resolve));
  hub.sendToDevice(device, { confidential: "blocked" });
  expect(await closed).toBe(4003);
  expect(received).toEqual([]);
});

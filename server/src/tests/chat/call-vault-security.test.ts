import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { SignJWT } from "jose";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import type { FileVaultService } from "../../services/file-vault.service.js";
import type { SignalingService } from "../../services/signaling.service.js";
import { registerFileVaultRoutes } from "../../routes/file-vault.js";
import { registerVaultIntakeRoutes } from "../../routes/vault-intake.js";
import { registerSignaling } from "../../realtime/signaling.register.js";
import { RealtimeHub } from "../../realtime/hub.js";

const config = { NODE_ENV: "test", JWT_ISSUER: "call-vault-test", JWT_AUDIENCE: "linqa-api", JWT_HS256_SECRET: "call-vault-fixture-secret-at-least-32-bytes" } as AppConfig;
const user = "00000000-0000-4000-8000-000000000001", device = "00000000-0000-4000-8000-000000000002", call = "00000000-0000-4000-8000-000000000003", session = "00000000-0000-4000-8000-000000000004";
const apps: ReturnType<typeof Fastify>[] = [], sockets: WebSocket[] = [];
afterEach(async () => { sockets.splice(0).forEach(socket => socket.terminate()); await Promise.all(apps.splice(0).map(app => app.close())); });
async function token(scope = "calls:write vault:read") {
  return new SignJWT({ user_id: user, device_id: device, sid: session, scope }).setProtectedHeader({ alg: "HS256" }).setSubject(user)
    .setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime("5m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
}
function database() {
  const state = { active: true };
  const query = vi.fn(async (sql: string) => ({ rows: [], rowCount: sql.includes("auth_sessions") && !state.active ? 0 : 1 }));
  return { state, db: { query } as unknown as Database };
}
it("blocks revoked sessions before reading vault data or intake capabilities", async () => {
  const { state, db } = database(); const app = Fastify(); apps.push(app);
  const list = vi.fn(async () => []);
  await registerFileVaultRoutes(app, config, { list } as unknown as FileVaultService, undefined, undefined, db);
  await registerVaultIntakeRoutes(app, config, db);
  const headers = { authorization: `Bearer ${await token()}` };
  expect((await app.inject({ url: "/v1/vault/items", headers })).statusCode).toBe(200);
  expect((await app.inject({ url: "/v1/vault/intake/capabilities", headers })).statusCode).toBe(200);
  state.active = false;
  expect((await app.inject({ url: "/v1/vault/items", headers })).statusCode).not.toBe(200);
  expect((await app.inject({ url: "/v1/vault/intake/capabilities", headers })).statusCode).toBe(401);
  expect(list).toHaveBeenCalledTimes(1);
});
it("refuses production vault registration without persistent authorization storage", async () => {
  const app = Fastify(); apps.push(app);
  await expect(registerFileVaultRoutes(app, { ...config, NODE_ENV: "production" }, {} as FileVaultService)).rejects.toThrow("VAULT_AUTHORIZATION_DATABASE_REQUIRED");
});

async function signaling(scope = "calls:write") {
  const { state, db } = database(); const app = Fastify(); apps.push(app);
  await app.register(websocket);
  const append = vi.fn(async () => ({ created_at: new Date().toISOString() }));
  await registerSignaling(app, config, db, { append } as unknown as SignalingService, new RealtimeHub());
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as { port: number };
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/calls/signaling?callId=${call}`, { headers: { authorization: `Bearer ${await token(scope)}` } });
  sockets.push(socket);
  const outcome = new Promise<{ code?: number; message?: unknown }>((resolve, reject) => {
    socket.once("message", raw => resolve({ message: JSON.parse(raw.toString()) })); socket.once("close", code => resolve({ code })); socket.once("error", reject);
  });
  return { state, append, socket, outcome };
}
it("requires exact call scope at the legacy signaling handshake", async () => {
  const { outcome, append } = await signaling("messages:read");
  expect((await outcome).code).toBe(4001); expect(append).not.toHaveBeenCalled();
});
it("checks established call authorization before handling another frame", async () => {
  const { state, socket, outcome, append } = await signaling();
  expect((await outcome).message).toEqual({ type: "ready" });
  state.active = false;
  const closed = new Promise<number>(resolve => socket.once("close", resolve)); socket.send("ping");
  expect(await closed).toBe(4003); expect(append).not.toHaveBeenCalled();
});
it("rejects fractional sequences and cleartext extras before persisting signaling", async () => {
  const { socket, outcome, append } = await signaling(); await outcome;
  const frame = { callId: call, recipientDeviceId: user, sequence: 1, eventType: "OFFER", ciphertextBase64: Buffer.alloc(16, 7).toString("base64") };
  socket.send(JSON.stringify({ ...frame, sequence: 1.5 })); socket.send(JSON.stringify({ ...frame, plaintext: "must not be stored" }));
  const pong = new Promise<string>(resolve => socket.once("message", raw => resolve(raw.toString()))); socket.send("ping");
  expect(await pong).toBe("pong"); expect(append).not.toHaveBeenCalled();
  socket.send(JSON.stringify(frame));
  await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1));
});

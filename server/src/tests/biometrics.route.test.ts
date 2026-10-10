import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { issueAccessToken } from "../auth/tokens.js";
import type { AppConfig } from "../config.js";
import { registerBiometricRoutes } from "../routes/biometrics.js";
import type { BiometricAuthorizationService } from "../security/biometrics/service.js";

const config = { NODE_ENV: "test", JWT_ISSUER: "linqa-test", JWT_AUDIENCE: "linqa-api", JWT_HS256_SECRET: "biometric-route-test-secret-over-32-bytes" } as AppConfig;
const principal = { userId: randomUUID(),deviceId: randomUUID(),sessionId: randomUUID(),installationId: randomUUID() };
async function fixture(scopes = ["vault:read","linqasend:write"], device = true) {
  const app = Fastify();
  const status = vi.fn(async () => ({ enrolled: false })), challenge = vi.fn(async () => ({ challengeId: randomUUID() }));
  await registerBiometricRoutes(app,config,{ status,challenge } as unknown as BiometricAuthorizationService);
  const token = await issueAccessToken(config,{ userId: principal.userId,subject: principal.userId,scopes,sessionId: principal.sessionId,...(device ? { deviceId: principal.deviceId } : {}) });
  return { app,status,challenge,headers: { authorization: `Bearer ${token}`,"x-installation-id": principal.installationId } };
}
describe("biometric route boundaries", () => {
  it("derives identity from the authenticated token and installation header", async () => {
    const f = await fixture(); try {
      expect((await f.app.inject({ method: "GET",url: "/v1/security/biometrics/status",headers: f.headers })).statusCode).toBe(200);
      expect(f.status).toHaveBeenCalledWith(principal);
    } finally { await f.app.close(); }
  });
  it("rejects unauthenticated callers", async () => {
    const f = await fixture(); try { expect((await f.app.inject({ method: "GET",url: "/v1/security/biometrics/status" })).statusCode).toBe(403); expect(f.status).not.toHaveBeenCalled(); } finally { await f.app.close(); }
  });
  it("rejects a session without a device claim", async () => {
    const f = await fixture(undefined,false); try { expect((await f.app.inject({ method: "GET",url: "/v1/security/biometrics/status",headers: f.headers })).statusCode).toBe(403); expect(f.status).not.toHaveBeenCalled(); } finally { await f.app.close(); }
  });
  it("rejects body identity or arbitrary resource hashes", async () => {
    const f = await fixture(); try {
      for (const extra of [{ userId: randomUUID() },{ resourceHash: "a".repeat(64) }]) {
        expect((await f.app.inject({ method: "POST",url: "/v1/security/biometrics/challenges",headers: f.headers,payload: { purpose: "VAULT_UNLOCK",...extra } })).statusCode).toBe(422);
      }
      expect(f.challenge).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
  });
  it("requires the payment scope and a server payment reference", async () => {
    const f = await fixture(["vault:read"]); try {
      expect((await f.app.inject({ method: "POST",url: "/v1/security/biometrics/challenges",headers: f.headers,payload: { purpose: "SEND_TRANSFER_AUTHORIZE",paymentChallengeId: randomUUID() } })).statusCode).toBe(403);
      expect(f.challenge).not.toHaveBeenCalled();
    } finally { await f.app.close(); }
    const payment = await fixture(); try {
      expect((await payment.app.inject({ method: "POST",url: "/v1/security/biometrics/challenges",headers: payment.headers,payload: { purpose: "SEND_TRANSFER_AUTHORIZE" } })).statusCode).toBe(403);
      expect(payment.challenge).not.toHaveBeenCalled();
    } finally { await payment.app.close(); }
  });
});

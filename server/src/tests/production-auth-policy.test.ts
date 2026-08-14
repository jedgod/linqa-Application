import Fastify from "fastify";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { createAuthenticator } from "../auth/jwt.js";
import { issueAccessToken } from "../auth/tokens.js";
import { isAuthenticationPurpose, PRE_ENROLLMENT_SCOPES } from "../routes/auth.js";

const baseConfig: AppConfig = {
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: 8080,
  DATABASE_URL: "postgresql://unused",
  JWT_ISSUER: "https://auth.linqa.test",
  JWT_AUDIENCE: "linqa-api",
  JWT_HS256_SECRET: "development-secret-that-is-at-least-32-bytes",
  CONTACT_DISCOVERY_SECRET: "contact-discovery-secret-at-least-32-bytes",
  TOKEN_VAULT_KEY_BASE64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  TURN_SHARED_SECRET: "turn-secret-that-is-at-least-32-bytes-long",
  TURN_URLS: ["turn:127.0.0.1:3478"],
  CORS_ORIGINS: ["https://linqa.test"],
  DEVICE_CHALLENGE_TTL_SECONDS: 300,
  ENVELOPE_TTL_SECONDS: 2_592_000,
  MAX_ENVELOPE_BYTES: 262_144,
  DELIVERY_LEASE_SECONDS: 60,
  PASSKEY_RP_ID: "linqa.test",
  PASSKEY_RP_NAME: "Linqa",
  PASSKEY_ORIGINS: ["https://linqa.test"],
  APNS_SANDBOX: false,
  BILLING_WEBHOOK_TOLERANCE_SECONDS: 300,
  LINQASEND_WEBHOOK_TOLERANCE_SECONDS: 300,
  COUNTRY_SELECTION_PREMIUM_LIMIT: 20,
  LOG_LEVEL: "fatal"
};

describe("production authentication policy", () => {
  it("round-trips first-party EdDSA access tokens in production", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA", { extractable: true });
    const config: AppConfig = {
      ...baseConfig,
      JWT_SIGNING_PRIVATE_KEY_PEM: await exportPKCS8(privateKey),
      JWT_VERIFYING_PUBLIC_KEY_PEM: await exportSPKI(publicKey)
    };
    const token = await issueAccessToken(config, {
      userId: "00000000-0000-4000-8000-000000000001",
      subject: "linqa-user-1",
      deviceId: "10000000-0000-4000-8000-000000000001",
      scopes: ["profile:read"],
      sessionId: "20000000-0000-4000-8000-000000000001"
    });
    const app = Fastify();
    const authenticate = createAuthenticator(config);
    app.get("/protected", async (request) => {
      const principal = await authenticate(request);
      return { userId: principal.userId, subject: principal.subject };
    });
    const response = await app.inject({ method: "GET", url: "/protected", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: "00000000-0000-4000-8000-000000000001", subject: "linqa-user-1" });
    await app.close();
  });

  it("allows only login and registration challenges to create sessions", () => {
    expect(isAuthenticationPurpose("LOGIN")).toBe(true);
    expect(isAuthenticationPurpose("REGISTRATION")).toBe(true);
    expect(isAuthenticationPurpose("RECOVERY")).toBe(false);
    expect(isAuthenticationPurpose("ADD_IDENTIFIER")).toBe(false);
    expect(isAuthenticationPurpose("HIGH_RISK_ACTION")).toBe(false);
  });

  it("keeps pre-enrollment tokens read-only and minimal", () => {
    expect(PRE_ENROLLMENT_SCOPES).toEqual(["profile:read", "devices:read"]);
    expect(PRE_ENROLLMENT_SCOPES.some((scope) => scope.endsWith(":write"))).toBe(false);
  });
});

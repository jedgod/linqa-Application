import { generateKeyPairSync, randomUUID, sign as cryptoSign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { buildApp } from "../app.js";
import { issueAccessToken } from "../auth/tokens.js";
import { canonicalEnrollmentDigest } from "../auth/enrollment-proof.js";

const config: AppConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 8080,
  DATABASE_URL: "postgresql://unused",
  JWT_ISSUER: "https://test.linqa.local",
  JWT_AUDIENCE: "linqa-api",
  JWT_HS256_SECRET: "test-secret-that-is-at-least-32-bytes-long",
  CONTACT_DISCOVERY_SECRET: "test-contact-discovery-secret-value",
  TOKEN_VAULT_KEY_BASE64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  TURN_SHARED_SECRET: "test-turn-secret-that-is-at-least-32-bytes",
  TURN_URLS: ["turn:127.0.0.1:3478?transport=udp"],
  CORS_ORIGINS: ["http://127.0.0.1:5173"],
  DEVICE_CHALLENGE_TTL_SECONDS: 300,
  ENVELOPE_TTL_SECONDS: 2_592_000,
  MAX_ENVELOPE_BYTES: 262_144,
  DELIVERY_LEASE_SECONDS: 60,
  PASSKEY_RP_ID: "test.linqa.local",
  PASSKEY_RP_NAME: "Linqa Test",
  PASSKEY_ORIGINS: ["https://test.linqa.local"],
  APNS_SANDBOX: false,
  BILLING_WEBHOOK_TOLERANCE_SECONDS: 300,
  LINQASEND_WEBHOOK_TOLERANCE_SECONDS: 300,
  COUNTRY_SELECTION_PREMIUM_LIMIT: 20,
  LOG_LEVEL: "fatal"
};

interface ChallengeRow {
  id: string;
  user_id: string;
  nonce: Buffer;
  expires_at: string;
  consumed_at: string | null;
}

function makeDatabase() {
  const challenges = new Map<string, ChallengeRow>();

  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT id, user_id, nonce, expires_at, consumed_at")) {
        const row = challenges.get(params[0] as string);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("INSERT INTO devices")) {
        return { rows: [{ id: randomUUID() }] };
      }
      if (sql.includes("UPDATE device_registration_challenges SET consumed_at")) {
        const row = challenges.get(params[0] as string);
        if (row) row.consumed_at = new Date().toISOString();
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {}
  };

  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("schema_migrations")) return { rows: [{ count: 9 }] };
      if (sql.includes("INSERT INTO device_registration_challenges")) {
        const id = randomUUID();
        const expiresAt = new Date(Date.now() + config.DEVICE_CHALLENGE_TTL_SECONDS * 1000).toISOString();
        challenges.set(id, {
          id,
          user_id: params[0] as string,
          nonce: params[1] as Buffer,
          expires_at: expiresAt,
          consumed_at: null
        });
        return { rows: [{ id, expires_at: expiresAt }] };
      }
      if (sql.includes("INSERT INTO auth_sessions")) {
        return { rows: [{ id: randomUUID() }] };
      }
      return { rows: [{ "?column?": 1 }] };
    },
    connect: async () => client
  } as unknown as Database;
}

describe("device enrollment (routes/enrollment.ts)", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("activates a device given a validly signed Ed25519 proof", async () => {
    const database = makeDatabase();
    app = await buildApp(config, database);

    const userId = randomUUID();
    const token = await issueAccessToken(config, {
      userId,
      subject: userId,
      scopes: [],
      sessionId: "session-1"
    });

    const challengeResponse = await app.inject({
      method: "POST",
      url: "/v1/device-enrollment/challenges",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(challengeResponse.statusCode).toBe(201);
    const challengeBody = challengeResponse.json();

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const rawSigningPublicKey = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
    const encryptionPublicKey = Buffer.alloc(32, 3);

    const digest = canonicalEnrollmentDigest(
      {
        challengeId: challengeBody.challengeId,
        userId: challengeBody.userId,
        nonce: Buffer.from(challengeBody.nonceBase64, "base64"),
        expiresAtUnix: BigInt(Math.floor(new Date(challengeBody.expiresAt).getTime() / 1000))
      },
      {
        deviceName: "Integration Test Device",
        platform: "WEB",
        signingPublicKey: rawSigningPublicKey,
        encryptionPublicKey
      }
    );
    const signature = cryptoSign(null, digest, privateKey);

    const completeResponse = await app.inject({
      method: "POST",
      url: "/v1/device-enrollment/complete",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        challengeId: challengeBody.challengeId,
        deviceName: "Integration Test Device",
        platform: "WEB",
        signingPublicKeyBase64: rawSigningPublicKey.toString("base64"),
        encryptionPublicKeyBase64: encryptionPublicKey.toString("base64"),
        signatureBase64: signature.toString("base64")
      }
    });

    expect(completeResponse.statusCode).toBe(201);
    const completeBody = completeResponse.json();
    expect(completeBody.status).toBe("ACTIVE");

    expect(completeBody.session.accessToken).toEqual(expect.any(String));
    expect(completeBody.session.refreshToken).toEqual(expect.any(String));
    const decoded = decodeJwt(completeBody.session.accessToken);
    expect(decoded.device_id).toBe(completeBody.deviceId);
    expect(String(decoded.scope)).toContain("calls:write");
    expect(String(decoded.scope)).toContain("keys:write");
  }, 20000);

  it("rejects completion with a tampered signature", async () => {
    const database = makeDatabase();
    app = await buildApp(config, database);

    const userId = randomUUID();
    const token = await issueAccessToken(config, {
      userId,
      subject: userId,
      scopes: [],
      sessionId: "session-1"
    });

    const challengeResponse = await app.inject({
      method: "POST",
      url: "/v1/device-enrollment/challenges",
      headers: { authorization: `Bearer ${token}` }
    });
    const challengeBody = challengeResponse.json();

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const rawSigningPublicKey = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
    const encryptionPublicKey = Buffer.alloc(32, 3);

    const digest = canonicalEnrollmentDigest(
      {
        challengeId: challengeBody.challengeId,
        userId: challengeBody.userId,
        nonce: Buffer.from(challengeBody.nonceBase64, "base64"),
        expiresAtUnix: BigInt(Math.floor(new Date(challengeBody.expiresAt).getTime() / 1000))
      },
      {
        deviceName: "Integration Test Device",
        platform: "WEB",
        signingPublicKey: rawSigningPublicKey,
        encryptionPublicKey
      }
    );
    const signature = cryptoSign(null, digest, privateKey);
    signature.writeUInt8(signature.readUInt8(0) ^ 0xff, 0);

    const completeResponse = await app.inject({
      method: "POST",
      url: "/v1/device-enrollment/complete",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        challengeId: challengeBody.challengeId,
        deviceName: "Integration Test Device",
        platform: "WEB",
        signingPublicKeyBase64: rawSigningPublicKey.toString("base64"),
        encryptionPublicKeyBase64: encryptionPublicKey.toString("base64"),
        signatureBase64: signature.toString("base64")
      }
    });

    expect(completeResponse.statusCode).toBe(401);
    expect(completeResponse.json().error).toBe("invalid_proof");
  });
});

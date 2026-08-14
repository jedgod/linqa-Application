import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { buildApp } from "../app.js";
import { issueAccessToken } from "../auth/tokens.js";

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

const ROOM_ID = "00000000-0000-4000-8000-0000000000ee";

// Room owned by "user-owner"; "user-mallory" was never invited.
const database = {
  query: async (sql: string, params?: unknown[]) => {
    if (sql.includes("schema_migrations")) return { rows: [{ count: 6 }] };
    if (sql.includes("FROM collaboration_rooms")) {
      return { rows: [{ status: "ACTIVE" }], rowCount: 1 };
    }
    if (sql.includes("FROM collaboration_subscriptions")) {
      const deviceId = params?.[1];
      if (deviceId === "00000000-0000-4000-8000-0000000000dd") {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO collaboration_events")) {
      return { rows: [{ id: "event-1", created_at: new Date().toISOString() }], rowCount: 1 };
    }
    return { rows: [{ "?column?": 1 }] };
  }
} as unknown as Database;

describe("collaboration room routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("registers create, invite, remove, write, and read routes", async () => {
    app = await buildApp(config, database);
    await app.ready();

    expect(app.hasRoute({ method: "POST", url: "/v1/collaboration/rooms" })).toBe(true);
    expect(
      app.hasRoute({ method: "POST", url: "/v1/collaboration/rooms/:roomId/participants" })
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "DELETE",
        url: "/v1/collaboration/rooms/:roomId/participants/:deviceId"
      })
    ).toBe(true);
    expect(
      app.hasRoute({ method: "POST", url: "/v1/collaboration/rooms/:roomId/events" })
    ).toBe(true);
    expect(
      app.hasRoute({ method: "GET", url: "/v1/collaboration/rooms/:roomId/events" })
    ).toBe(true);
  });

  it("allows a room member device to post an event", async () => {
    app = await buildApp(config, database);

    const token = await issueAccessToken(config, {
      userId: "user-owner",
      subject: "user-owner",
      deviceId: "00000000-0000-4000-8000-0000000000dd",
      scopes: ["collaboration:write"],
      sessionId: "session-1"
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/collaboration/rooms/${ROOM_ID}/events`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        eventType: "POLL_VOTE",
        ciphertextBase64: Buffer.alloc(16, 1).toString("base64"),
        logicalClock: 1
      }
    });

    expect(response.statusCode).toBe(201);
  });

  it("rejects a non-member device from posting an event into someone else's room", async () => {
    app = await buildApp(config, database);

    const token = await issueAccessToken(config, {
      userId: "user-mallory",
      subject: "user-mallory",
      deviceId: "00000000-0000-4000-8000-0000000000ff",
      scopes: ["collaboration:write"],
      sessionId: "session-2"
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/collaboration/rooms/${ROOM_ID}/events`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        eventType: "POLL_VOTE",
        ciphertextBase64: Buffer.alloc(16, 1).toString("base64"),
        logicalClock: 1
      }
    });

    // Mapped through the route's generic catch to 400 (invalid_request),
    // matching this codebase's existing convention for service-thrown
    // errors — the important thing is the write never reaches the DB.
    expect(response.statusCode).toBe(400);
  });

  it("rejects a non-member device from reading room events", async () => {
    app = await buildApp(config, database);

    const token = await issueAccessToken(config, {
      userId: "user-mallory",
      subject: "user-mallory",
      deviceId: "00000000-0000-4000-8000-0000000000ff",
      scopes: ["collaboration:read"],
      sessionId: "session-2"
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/collaboration/rooms/${ROOM_ID}/events`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(400);
  });
});

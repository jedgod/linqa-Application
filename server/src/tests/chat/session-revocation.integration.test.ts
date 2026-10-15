import { randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ensureTestDatabase } from "../support/test-database.js";
import type { Database } from "../../db/pool.js";
import type { AppConfig } from "../../config.js";
import { SessionService } from "../../services/session.service.js";
import { assertActivePrincipal } from "../../auth/active-principal.js";
import { registerThreadAttachmentRoutes } from "../../chat/thread-attachment.routes.js";

const testDatabase = await ensureTestDatabase();
const suite = testDatabase ? describe : describe.skip;
const config = { NODE_ENV: "test", JWT_ISSUER: "session-db-test", JWT_AUDIENCE: "linqa-api", JWT_HS256_SECRET: "session-integration-fixture-key-at-least-32-bytes" } as AppConfig;

suite("persistent chat session revocation", () => {
  const pool = new pg.Pool({ connectionString: testDatabase?.connectionString });
  const db = pool as unknown as Database;
  const users: string[] = [];
  afterAll(async () => { if (users.length) await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]); await pool.end(); });
  async function fixture() {
    const userId = randomUUID(), deviceId = randomUUID(); users.push(userId);
    await pool.query("INSERT INTO users(id,external_subject,status) VALUES($1,$2,'ACTIVE')", [userId, `session-security-${userId}`]);
    await pool.query("INSERT INTO devices(id,user_id,device_name,platform,signing_public_key,encryption_public_key,status) VALUES($1,$2,'Test','ANDROID',$3,$4,'ACTIVE')", [deviceId, userId, randomBytes(32), randomBytes(32)]);
    const service = new SessionService(db, config);
    const session = await service.create({ userId, subject: userId, deviceId, scopes: ["messages:read"] });
    const principal = { userId, deviceId, sessionId: session.sessionId, subject: userId, scopes: new Set(["messages:read"]) };
    return { service, session, principal };
  }
  it("rejects an already-issued access token immediately after logout", async () => {
    const { service, session, principal } = await fixture();
    const app = Fastify(); await registerThreadAttachmentRoutes(app, config, db);
    const request = { url: `/v2/chats/${randomUUID()}/attachments`, headers: { authorization: `Bearer ${session.accessToken}` } };
    try {
      // Active authentication reaches the membership check for an unknown conversation.
      expect((await app.inject(request)).statusCode).toBe(404);
      await service.revokeSession(session.sessionId);
      expect((await app.inject(request)).statusCode).toBe(401);
      await expect(assertActivePrincipal(db, principal)).rejects.toThrow("SESSION_AUTHENTICATION_REVOKED");
    } finally { await app.close(); }
  });
  it("enforces expiry and user/device binding using real PostgreSQL predicates", async () => {
    const a = await fixture(), b = await fixture();
    await expect(assertActivePrincipal(db, a.principal)).resolves.toBeUndefined();
    await expect(assertActivePrincipal(db, { ...a.principal, sessionId: b.session.sessionId })).rejects.toThrow("SESSION_AUTHENTICATION_REVOKED");
    await pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [a.session.sessionId]);
    await expect(assertActivePrincipal(db, a.principal)).rejects.toThrow("SESSION_AUTHENTICATION_REVOKED");
    await pool.query("UPDATE devices SET revoked_at=now() WHERE id=$1", [b.principal.deviceId]);
    await expect(assertActivePrincipal(db, b.principal)).rejects.toThrow("DEVICE_AUTHENTICATION_REVOKED");
    await expect(b.service.rotate({ refreshToken: b.session.refreshToken })).rejects.toThrow("inactive refresh session");
  });
});

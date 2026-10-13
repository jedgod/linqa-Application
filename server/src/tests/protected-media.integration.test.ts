import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { SignJWT } from "jose";
import { ensureTestDatabase } from "./support/test-database.js";
import { loadConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { registerProtectedMediaRoutes } from "../routes/protected-media.js";
import { RealtimeHub } from "../realtime/hub.js";
import { setAuditKey } from "../protected-media/audit-chain.js";
import { MediaHttpError, ProtectedMediaService } from "../protected-media/service.js";

const database = await ensureTestDatabase();
const suite = database ? describe : describe.skip;
const config = loadConfig();
let db: Database;
let service: ProtectedMediaService;
const alerts: string[] = [];
const users: string[] = [];
const blob = Buffer.from("opaque ciphertext, never an image");

async function pair() {
  const sender = randomUUID(), recipient = randomUUID(), conversation = randomUUID();
  users.push(sender, recipient);
  for (const id of [sender, recipient]) await db.query("INSERT INTO users(id,external_subject,status) VALUES($1,$2,'ACTIVE')", [id, `protected-media-${id}`]);
  await db.query("INSERT INTO conversations(id,conversation_type,created_by_user_id) VALUES($1,'DIRECT',$2)", [conversation, sender]);
  await db.query("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES($1,$2,'OWNER'),($1,$3,'MEMBER')", [conversation, sender, recipient]);
  return { sender, recipient, conversation };
}
const token = (user: string) => new SignJWT({ user_id: user, scope: "messages:read" }).setProtectedHeader({ alg: "HS256" })
  .setSubject(user).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime("5m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
const status = async (fn: Promise<unknown>) => { try { await fn; return 0; } catch (error) { return error instanceof MediaHttpError ? error.status : -1; } };

beforeAll(async () => {
  if (!database) return;
  db = new pg.Pool({ connectionString: database.connectionString }) as unknown as Database;
  setAuditKey("protected-media-test-audit-key-32-characters");
  service = new ProtectedMediaService(db, { sendToUser: (_user: string, payload: unknown) => alerts.push((payload as { alert: { type: string } }).alert.type) });
});
afterAll(async () => {
  if (!database) return;
  await db.query("DELETE FROM conversations WHERE created_by_user_id = ANY($1::uuid[])", [users]);
  await db.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await (db as unknown as pg.Pool).end();
});

suite("protected photos", () => {
  it("only lets someone in the conversation receive one, and enforces the policy limits", async () => {
    const { sender, recipient, conversation } = await pair();
    expect(await status(service.create(sender, { recipientId: randomUUID(), conversationId: conversation, policy: { mode: "EPHEMERAL" } }, blob))).toBe(403);
    expect(await status(service.create(sender, { recipientId: recipient, conversationId: conversation, policy: { mode: "EPHEMERAL", maxViews: 5 } }, blob))).toBe(400);
    expect(await status(service.create(sender, { recipientId: sender, conversationId: conversation, policy: { mode: "EPHEMERAL" } }, blob))).toBe(400);
  });

  it("view once: one download, then the ciphertext is wiped and every step is audited", async () => {
    const { sender, recipient, conversation } = await pair();
    const media = await service.create(sender, { recipientId: recipient, conversationId: conversation, policy: { mode: "EPHEMERAL", maxViews: 1, viewSeconds: 10 } }, blob);
    expect(await status(service.requestView(media.id, sender, {}))).toBe(404);
    const grant = await service.requestView(media.id, recipient, { platform: "android" });
    expect(grant.remainingViews).toBe(0);
    expect((await service.fetchCiphertext(media.id, grant.viewId, recipient, grant.token)).equals(blob)).toBe(true);
    expect(await status(service.fetchCiphertext(media.id, grant.viewId, recipient, grant.token))).toBe(410);
    expect((await service.getStatus(media.id, sender)).status).toBe("EXHAUSTED");
    const stored = await db.query("SELECT blob IS NOT NULL AS has FROM protected_media WHERE id = $1", [media.id]);
    expect(stored.rows[0].has).toBe(false);
    expect(await status(service.requestView(media.id, recipient, {}))).toBe(410);
    await service.endView(media.id, grant.viewId, recipient, "closed");
    const trail = await service.getAudit(media.id, sender);
    expect(trail.integrity.valid).toBe(true);
    expect(trail.events.map((event) => event.type)).toEqual(expect.arrayContaining(["CREATED", "VIEW_GRANTED", "BLOB_DELIVERED", "EXHAUSTED", "BLOB_DELETED", "VIEW_ENDED"]));
    expect(alerts).toEqual(expect.arrayContaining(["VIEWED", "EXHAUSTED"]));
  });

  it("a screenshot revokes view-once access and alerts the sender; editing the log is detected", async () => {
    const { sender, recipient, conversation } = await pair();
    const media = await service.create(sender, { recipientId: recipient, conversationId: conversation, policy: { mode: "EPHEMERAL", maxViews: 2 } }, blob);
    const grant = await service.requestView(media.id, recipient, {});
    expect((await service.reportCapture(media.id, recipient, "screenshot", grant.viewId, {})).revoked).toBe(true);
    expect((await service.getStatus(media.id, sender)).status).toBe("CAPTURE_REVOKED");
    expect(alerts).toEqual(expect.arrayContaining(["SCREENSHOT", "CAPTURE_REVOKED"]));
    expect((await service.getAudit(media.id, sender)).integrity.valid).toBe(true);
    await db.query("UPDATE protected_media_audit SET type = 'REVOKED_BY_SENDER' WHERE media_id = $1 AND seq = 2", [media.id]);
    expect((await service.getAudit(media.id, sender)).integrity.valid).toBe(false);
  });

  it("limited views keep the photo until the last one; only the sender can revoke", async () => {
    const { sender, recipient, conversation } = await pair();
    const media = await service.create(sender, { recipientId: recipient, conversationId: conversation, policy: { mode: "MULTI_VIEW", maxViews: 3, viewSeconds: 15 } }, blob);
    expect((await service.requestView(media.id, recipient, {})).remainingViews).toBe(2);
    expect((await service.getStatus(media.id, recipient)).status).toBe("ACTIVE");
    expect(await status(service.revoke(media.id, recipient))).toBe(403);
    expect((await service.revoke(media.id, sender)).status).toBe("REVOKED");
  });

  it("a timed photo expires when its window ends", async () => {
    const { sender, recipient, conversation } = await pair();
    const media = await service.create(sender, { recipientId: recipient, conversationId: conversation, policy: { mode: "TIMED", windowSeconds: 30, expiryStart: "ON_SEND" } }, blob);
    expect(await service.sweep(new Date(Date.now() + 31_000))).toBeGreaterThanOrEqual(1);
    expect((await service.getStatus(media.id, sender)).status).toBe("EXPIRED");
  });

  it("the HTTP routes need a signed-in user and hide photos from outsiders", async () => {
    const { sender, recipient, conversation } = await pair();
    const app = Fastify();
    await registerProtectedMediaRoutes(app, config, db, new RealtimeHub());
    try {
      const query = new URLSearchParams({ recipientId: recipient, conversationId: conversation, policy: JSON.stringify({ mode: "MULTI_VIEW", maxViews: 2 }) });
      const unsigned = await app.inject({ method: "POST", url: `/v1/protected-media?${query}`, headers: { "content-type": "application/octet-stream" }, payload: blob });
      expect(unsigned.statusCode).toBe(401);
      const auth = { authorization: `Bearer ${await token(sender)}` };
      const created = await app.inject({ method: "POST", url: `/v1/protected-media?${query}`, headers: { ...auth, "content-type": "application/octet-stream" }, payload: blob });
      expect(created.statusCode).toBe(200);
      const id = created.json().id as string;
      const outsider = { authorization: `Bearer ${await token(randomUUID())}` };
      expect((await app.inject({ method: "GET", url: `/v1/protected-media/${id}`, headers: outsider })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `/v1/protected-media/${id}`, headers: auth })).json().role).toBe("sender");
      expect((await app.inject({ method: "GET", url: "/v1/protected-media/not-a-uuid", headers: auth })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

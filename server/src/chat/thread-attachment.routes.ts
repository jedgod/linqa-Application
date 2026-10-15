import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { assertActivePrincipal } from "../auth/active-principal.js";
import { ChatError } from "./chat.service.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { simpleRateLimit } from "../services/countrylinqa/final/rate-limit.js";
import { ATTACHMENT_KINDS, ThreadAttachmentService } from "./thread-attachment.service.js";
import { base64url, idParam, makeRunner, toBuffer, uuid } from "./thread-route-kit.js";

const limits = {
  write: simpleRateLimit({ windowMs: 60_000, max: 40, keyPrefix: "thread-attach" }),
  read: simpleRateLimit({ windowMs: 60_000, max: 120, keyPrefix: "thread-attach-read" }),
  location: simpleRateLimit({ windowMs: 3_600_000, max: 30, keyPrefix: "thread-location" })
};

/** Sealed attachments and live-location sharing for a conversation. Every handler: authenticate, rate limit, strict schema, member check. */
export async function registerThreadAttachmentRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const run = makeRunner(config,db);
  const attachments = new ThreadAttachmentService(db);

  const mediaLimit = simpleRateLimit({ windowMs: 3_600_000, max: 30, keyPrefix: "thread-media" });
  const authenticateMedia = createAuthenticator(config);
  app.post("/v2/chats/:id/media/:mediaId", { bodyLimit: 36_000_000, onRequest: async (request, reply) => {
    try { const who = await authenticateMedia(request); requireScope(who, "messages:send"); if (!who.deviceId) return reply.code(401).send({ error: { code: "DEVICE_REQUIRED" } }); await assertActivePrincipal(db, who); }
    catch { return reply.code(401).send({ error: { code: "UNAUTHENTICATED" } }); }
  } }, run("messages:send", mediaLimit, async (request, who) => {
    if (!who.deviceId) throw new ChatError(401, "DEVICE_REQUIRED");
    const params = z.object({ id: uuid, mediaId: uuid }).parse(request.params);
    const body = z.object({ envelopeBase64: base64url(35_000_000) }).strict().parse(request.body);
    return attachments.storeMedia({ id: params.mediaId, conversationId: params.id, userId: who.userId, deviceId: who.deviceId, envelope: toBuffer(body.envelopeBase64) });
  }, 201));
  app.get("/v2/chats/:id/media/:mediaId", run("messages:read", limits.read, async (request, who) => {
    const params = z.object({ id: uuid, mediaId: uuid }).parse(request.params);
    const envelope = await attachments.readMedia(who.userId, params.id, params.mediaId);
    return { envelopeBase64: envelope.toString("base64url") };
  }));

  app.post("/v2/chats/:id/attachments", run("messages:send", limits.write, async (request, who) => {
    const body = z.object({ id: uuid, kind: z.enum(ATTACHMENT_KINDS), vaultId: z.string().min(1).max(200).optional(), envelopeBase64: base64url() }).strict().parse(request.body);
    return attachments.accept({ id: body.id, conversationId: idParam(request), userId: who.userId, deviceId: who.deviceId, kind: body.kind, vaultId: body.vaultId ?? null, envelope: toBuffer(body.envelopeBase64) });
  }, 201));

  app.get("/v2/chats/:id/attachments", run("messages:read", limits.read, async (request, who) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(40) }).strict().parse(request.query ?? {});
    const rows = await attachments.list(who.userId, idParam(request), limit);
    return { attachments: rows.map((r) => ({ id: r.id, kind: r.kind, vaultId: r.vaultId, envelopeBase64: r.envelope.toString("base64url"), createdAt: r.createdAt, senderUserId: r.senderUserId })) };
  }));

  app.post("/v2/chats/:id/location-requests", run("messages:send", limits.location, async (request, who) => {
    const body = z.object({ id: uuid, peerUserId: uuid }).strict().parse(request.body);
    return attachments.requestLocation({ id: body.id, conversationId: idParam(request), userId: who.userId, peerUserId: body.peerUserId });
  }, 201));

  app.get("/v2/chats/:id/location-shares", run("messages:read", limits.read, async (request, who) => {
    const rows = await attachments.locationShares(who.userId, idParam(request));
    return { shares: rows.map((r) => ({ id: r.id, state: r.state, ownerUserId: r.ownerUserId, requestedBy: r.requestedBy, expiresAt: r.expiresAt, createdAt: r.createdAt, envelopeBase64: r.envelope ? r.envelope.toString("base64url") : null })) };
  }));

  app.post("/v2/location-shares/:id/answer", run("messages:send", limits.location, async (request, who) => {
    const body = z.object({ accept: z.boolean(), envelopeBase64: base64url().optional(), expiresAt: z.string().datetime().optional() }).strict().parse(request.body);
    return attachments.answerLocation({ id: idParam(request), userId: who.userId, accept: body.accept, ...(body.envelopeBase64 ? { envelope: toBuffer(body.envelopeBase64) } : {}), ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}) });
  }));

  app.post("/v2/location-shares/:id/stop", run("messages:send", limits.location, async (request, who) => attachments.stopLocation(idParam(request), who.userId)));
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { simpleRateLimit } from "../services/countrylinqa/final/rate-limit.js";
import { LiveScreenService } from "./live-screen.service.js";
import { base64url, idParam, makeRunner, toBuffer, uuid } from "./thread-route-kit.js";

const limits = {
  write: simpleRateLimit({ windowMs: 3_600_000, max: 30, keyPrefix: "live-screen" }),
  read: simpleRateLimit({ windowMs: 60_000, max: 120, keyPrefix: "live-screen-read" })
};

/** Signaling for a live screen share. Frames never come through here. */
export async function registerLiveScreenRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const run = makeRunner(config);
  const screens = new LiveScreenService(db);

  app.post("/v2/chats/:id/screen-shares", run("messages:send", limits.write, async (request, who) => {
    const body = z.object({ id: uuid, offerEnvelopeBase64: base64url(100_000) }).strict().parse(request.body);
    return screens.offer({ id: body.id, conversationId: idParam(request), userId: who.userId, deviceId: who.deviceId, offerEnvelope: toBuffer(body.offerEnvelopeBase64) });
  }, 201));

  app.get("/v2/chats/:id/screen-shares", run("messages:read", limits.read, async (request, who) => {
    const s = await screens.current(who.userId, idParam(request));
    return { session: s ? { id: s.id, state: s.state, hostUserId: s.hostUserId, createdAt: s.createdAt, envelopeBase64: s.envelope ? s.envelope.toString("base64url") : null } : null };
  }));

  app.post("/v2/screen-shares/:id/answer", run("messages:send", limits.write, async (request, who) => {
    const body = z.object({ accept: z.boolean(), answerEnvelopeBase64: base64url(100_000).optional() }).strict().parse(request.body);
    return screens.answer({ id: idParam(request), userId: who.userId, accept: body.accept, ...(body.answerEnvelopeBase64 ? { answerEnvelope: toBuffer(body.answerEnvelopeBase64) } : {}) });
  }));

  app.post("/v2/screen-shares/:id/stop", run("messages:send", limits.write, async (request, who) => screens.stop(idParam(request), who.userId)));
}

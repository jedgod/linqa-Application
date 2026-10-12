import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { simpleRateLimit } from "../services/countrylinqa/final/rate-limit.js";
import { HistoryTransferError, HistoryTransferService, LIMITS } from "./history-transfer.service.js";

const limits = {
  request: simpleRateLimit({ windowMs: 10 * 60_000, max: 8, keyPrefix: "history-request" }),
  chunk: simpleRateLimit({ windowMs: 60_000, max: 400, keyPrefix: "history-chunk" }),
  act: simpleRateLimit({ windowMs: 60_000, max: 120, keyPrefix: "history-act" })
};

const STATUS: Record<HistoryTransferError["code"], number> = {
  NOT_FOUND: 404, NOT_ALLOWED: 403, WRONG_STATE: 409, EXPIRED: 410, ALREADY_OPEN: 409, TOO_LARGE: 413, BAD_CHUNK: 422,
  INCOMPLETE: 409, PHONE_REQUIRED: 403, COMPUTER_REQUIRED: 403
};

const Id = z.object({ id: z.string().uuid() });
const ChunkParams = z.object({ id: z.string().uuid(), seq: z.coerce.number().int().min(0).max(LIMITS.maxChunks) });

/**
 * Older history for a linked computer. The computer asks, a phone approves and uploads sealed chunks, the computer downloads and opens
 * them. The server stores only sealed chunks, briefly. See history-transfer.service.ts for the rules.
 */
export async function registerHistoryTransferRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const service = new HistoryTransferService(db);
  const authenticate = createAuthenticator(config);

  const who = async (request: FastifyRequest) => {
    const principal = await authenticate(request);
    requireScope(principal, "messages:read");
    if (!principal.deviceId) throw new HistoryTransferError("NOT_ALLOWED");
    return { userId: principal.userId, deviceId: principal.deviceId };
  };
  const fail = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    if ((error as { status?: number })?.status === 429) return reply.code(429).send({ error: { code: "RATE_LIMITED" } });
    if (error instanceof HistoryTransferError) return reply.code(STATUS[error.code]).send({ error: { code: error.code } });
    if (error instanceof z.ZodError) return reply.code(422).send({ error: { code: "INVALID_REQUEST" } });
    if ((error as { statusCode?: number })?.statusCode === 401 || /token|auth|scope/i.test(String((error as Error)?.message))) return reply.code(401).send({ error: { code: "UNAUTHENTICATED" } });
    request.log.error({ err: error }, "history transfer request failed");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR" } });
  };
  const noStore = (reply: FastifyReply) => void reply.header("Cache-Control", "private, no-store");

  // The computer asks.
  app.post("/v1/history-transfers", async (request, reply) => {
    try {
      const me = await who(request);
      limits.request(me.userId, request);
      void service.purge().catch(() => undefined);
      noStore(reply);
      return reply.code(201).send(await service.request(me.userId, me.deviceId));
    } catch (error) { return fail(request, reply, error); }
  });

  // A phone asks what is waiting for its approval (this also tells the server the phone is online).
  app.get("/v1/history-transfers/pending", async (request, reply) => {
    try {
      const me = await who(request);
      limits.act(me.userId, request);
      noStore(reply);
      return reply.code(200).send({ items: await service.pendingFor(me.userId, me.deviceId) });
    } catch (error) { return fail(request, reply, error); }
  });

  app.get("/v1/history-transfers/:id", async (request, reply) => {
    try {
      const me = await who(request);
      limits.act(me.userId, request);
      const { id } = Id.parse(request.params);
      noStore(reply);
      return reply.code(200).send(await service.view(me.userId, id));
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/history-transfers/:id/approve", async (request, reply) => {
    try {
      const me = await who(request);
      limits.act(me.userId, request);
      const { id } = Id.parse(request.params);
      return reply.code(200).send(await service.approve(me.userId, me.deviceId, id));
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/history-transfers/:id/decline", async (request, reply) => {
    try {
      const me = await who(request);
      limits.act(me.userId, request);
      const { id } = Id.parse(request.params);
      await service.decline(me.userId, me.deviceId, id);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.put("/v1/history-transfers/:id/chunks/:seq", { bodyLimit: 600_000 }, async (request, reply) => {
    try {
      const me = await who(request);
      limits.chunk(me.userId, request);
      const { id, seq } = ChunkParams.parse(request.params);
      const body = z.object({ dataBase64: z.string().min(4).max(400_000), progress: z.object({ done: z.number().int().min(0), total: z.number().int().min(1) }).optional() }).strict().parse(request.body ?? {});
      await service.putChunk(me.userId, me.deviceId, id, seq, Buffer.from(body.dataBase64, "base64"), body.progress);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/history-transfers/:id/finish", async (request, reply) => {
    try {
      const me = await who(request);
      limits.act(me.userId, request);
      const { id } = Id.parse(request.params);
      const body = z.object({ chunkCount: z.number().int().min(0).max(LIMITS.maxChunks) }).strict().parse(request.body ?? {});
      await service.finish(me.userId, me.deviceId, id, body.chunkCount);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/history-transfers/:id/fail", async (request, reply) => {
    try {
      const me = await who(request);
      limits.act(me.userId, request);
      const { id } = Id.parse(request.params);
      const body = z.object({ code: z.string().max(40).default("PHONE_FAILED") }).strict().parse(request.body ?? {});
      await service.fail(me.userId, me.deviceId, id, body.code);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.get("/v1/history-transfers/:id/chunks/:seq", async (request, reply) => {
    try {
      const me = await who(request);
      limits.chunk(me.userId, request);
      const { id, seq } = ChunkParams.parse(request.params);
      noStore(reply);
      return reply.code(200).send({ dataBase64: (await service.getChunk(me.userId, me.deviceId, id, seq)).toString("base64") });
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/history-transfers/:id/complete", async (request, reply) => {
    try {
      const me = await who(request);
      limits.act(me.userId, request);
      const { id } = Id.parse(request.params);
      await service.complete(me.userId, me.deviceId, id);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/history-transfers/:id/cancel", async (request, reply) => {
    try {
      const me = await who(request);
      limits.act(me.userId, request);
      const { id } = Id.parse(request.params);
      await service.cancel(me.userId, me.deviceId, id);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });
}

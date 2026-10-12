import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { ChatError } from "../chat/chat.service.js";
import { simpleRateLimit } from "../services/countrylinqa/final/rate-limit.js";
import { REPORT_CATEGORIES, chatControls, clearChat, deleteChat, reportChat } from "./chat-controls.service.js";
import {
  LIST_COLORS, addGroupMembers, createChatList, createGroup, deleteChatList, listChatLists, renameChatList, setChatInList, setConversationArchived
} from "./chat-organization.service.js";

const limit = simpleRateLimit({ windowMs: 60_000, max: 120, keyPrefix: "chat-organization" });
const Id = z.object({ id: z.string().uuid() });
const ListChat = z.object({ id: z.string().uuid(), conversationId: z.string().uuid() });
const Color = z.enum(LIST_COLORS);

/** Lists, archive and groups. Every route is for the signed-in person's own organization; see chat-organization.service.ts. */
export async function registerChatOrganizationRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const authenticate = createAuthenticator(config);

  const who = async (request: FastifyRequest, scope: "messages:read" | "messages:send") => {
    const principal = await authenticate(request);
    requireScope(principal, scope);
    if(principal.deviceId){
      const device=await db.query("SELECT 1 FROM devices WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND revoked_at IS NULL",[principal.deviceId,principal.userId]);
      if(!device.rowCount)throw new Error('device authentication revoked');
    }
    limit(principal.userId, request);
    return principal.userId;
  };
  const fail = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    if ((error as { status?: number })?.status === 429) return reply.code(429).send({ error: { code: "RATE_LIMITED" } });
    if (error instanceof ChatError) return reply.code(error.status).send({ error: { code: error.code } });
    if (error instanceof z.ZodError) return reply.code(422).send({ error: { code: "INVALID_REQUEST" } });
    if ((error as { statusCode?: number })?.statusCode === 401 || /token|auth|scope/i.test(String((error as Error)?.message))) return reply.code(401).send({ error: { code: "UNAUTHENTICATED" } });
    request.log.error({ err: error }, "chat organization request failed");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR" } });
  };

  app.get("/v1/chat-lists", async (request, reply) => {
    try {
      const userId = await who(request, "messages:read");
      reply.header("Cache-Control", "private, no-store");
      return reply.code(200).send({ lists: await listChatLists(db, userId) });
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/chat-lists", async (request, reply) => {
    try {
      const userId = await who(request, "messages:read");
      const body = z.object({ name: z.string().min(1).max(80), color: Color.optional() }).strict().parse(request.body ?? {});
      return reply.code(201).send(await createChatList(db, userId, body.name, body.color));
    } catch (error) { return fail(request, reply, error); }
  });

  app.patch("/v1/chat-lists/:id", async (request, reply) => {
    try {
      const userId = await who(request, "messages:read");
      const { id } = Id.parse(request.params);
      const body = z.object({ name: z.string().min(1).max(80), color: Color.optional() }).strict().parse(request.body ?? {});
      await renameChatList(db, userId, id, body.name, body.color);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.delete("/v1/chat-lists/:id", async (request, reply) => {
    try {
      const userId = await who(request, "messages:read");
      await deleteChatList(db, userId, Id.parse(request.params).id);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.put("/v1/chat-lists/:id/chats/:conversationId", async (request, reply) => {
    try {
      const userId = await who(request, "messages:read");
      const p = ListChat.parse(request.params);
      await setChatInList(db, userId, p.id, p.conversationId, true);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.delete("/v1/chat-lists/:id/chats/:conversationId", async (request, reply) => {
    try {
      const userId = await who(request, "messages:read");
      const p = ListChat.parse(request.params);
      await setChatInList(db, userId, p.id, p.conversationId, false);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/chats/:id/archive", async (request, reply) => {
    try {
      const userId = await who(request, "messages:read");
      const { id } = Id.parse(request.params);
      const body = z.object({ archived: z.boolean() }).strict().parse(request.body ?? {});
      return reply.code(200).send(await setConversationArchived(db, userId, id, body.archived));
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/chats/groups", async (request, reply) => {
    try {
      const userId = await who(request, "messages:send");
      const body = z.object({ title: z.string().min(1).max(120), memberUserIds: z.array(z.string().uuid()).min(1).max(12) }).strict().parse(request.body ?? {});
      return reply.code(201).send(await createGroup(db, userId, body.title, body.memberUserIds));
    } catch (error) { return fail(request, reply, error); }
  });

  app.get("/v1/chats/:id/controls", async (request, reply) => {
    try {
      const userId = await who(request, "messages:read");
      reply.header("Cache-Control", "private, no-store");
      return reply.code(200).send(await chatControls(db, userId, Id.parse(request.params).id));
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/chats/:id/clear", async (request, reply) => {
    try {
      const userId = await who(request, "messages:send");
      await clearChat(db, userId, Id.parse(request.params).id);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/chats/:id/delete", async (request, reply) => {
    try {
      const userId = await who(request, "messages:send");
      await deleteChat(db, userId, Id.parse(request.params).id);
      return reply.code(204).send();
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/chats/:id/report", async (request, reply) => {
    try {
      const userId = await who(request, "messages:send");
      const { id } = Id.parse(request.params);
      const body = z.object({ category: z.enum(REPORT_CATEGORIES), description: z.string().min(10).max(4000) }).strict().parse(request.body ?? {});
      return reply.code(201).send(await reportChat(db, userId, id, body.category, body.description));
    } catch (error) { return fail(request, reply, error); }
  });

  app.post("/v1/chats/:id/members", async (request, reply) => {
    try {
      const userId = await who(request, "messages:send");
      const { id } = Id.parse(request.params);
      const body = z.object({ memberUserIds: z.array(z.string().uuid()).min(1).max(12) }).strict().parse(request.body ?? {});
      return reply.code(200).send(await addGroupMembers(db, userId, id, body.memberUserIds));
    } catch (error) { return fail(request, reply, error); }
  });
}

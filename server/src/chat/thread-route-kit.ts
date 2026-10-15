import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { assertActivePrincipal } from "../auth/active-principal.js";
import { ChatError } from "./chat.service.js";
import type { Database } from '../db/pool.js';

export type Who = { userId: string; deviceId: string | null };
export type Limiter = (userId: string, request: FastifyRequest) => void;

export const uuid = z.string().uuid();
export const base64url = (max = 400_000) => z.string().min(16).max(max).regex(/^[A-Za-z0-9_-]+={0,2}$/);
export const toBuffer = (value: string) => Buffer.from(value, "base64url");
export const idParam = (request: FastifyRequest) => uuid.parse((request.params as { id?: string }).id);

/**
 * The one shape every thread route follows: authenticate (401 when it fails), rate limit, run the handler, and turn any
 * failure into a coded response. Anything that is not a deliberate ChatError becomes an opaque 500; no stack, no SQL.
 */
export function makeRunner(config: AppConfig,db?:Database) {
  const authenticate = createAuthenticator(config);
  return function run(scope: string, limit: Limiter, handler: (request: FastifyRequest, who: Who) => Promise<unknown>, success = 200) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      let principal;
      try { principal = await authenticate(request); requireScope(principal, scope); if (db) await assertActivePrincipal(db, principal); }
      catch (error) { request.log.warn({ err: error }, "thread route authentication rejected"); return reply.code(401).send({ error: { code: "UNAUTHENTICATED", requestId: request.id } }); }
      try {
        limit(principal.userId, request);
        const result = await handler(request, { userId: principal.userId, deviceId: (principal as { deviceId?: string }).deviceId ?? null });
        void reply.header("Cache-Control", "private, no-store");
        return reply.code(success).send(result);
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(422).send({ error: { code: "INVALID_BODY", requestId: request.id } });
        if (error instanceof ChatError) return reply.code(error.status).send({ error: { code: error.code, requestId: request.id } });
        if ((error as { status?: number })?.status === 429) return reply.code(429).send({ error: { code: "RATE_LIMITED", requestId: request.id } });
        request.log.error({ err: error }, "thread route failed");
        return reply.code(500).send({ error: { code: "INTERNAL_ERROR", requestId: request.id } });
      }
    };
  };
}

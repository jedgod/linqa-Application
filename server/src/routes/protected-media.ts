import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { createAuthenticator } from "../auth/jwt.js";
import { setAuditKey } from "../protected-media/audit-chain.js";
import { MAX_CIPHERTEXT_BYTES, MediaHttpError, ProtectedMediaService } from "../protected-media/service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SWEEP_INTERVAL_MS = 5_000;

export async function registerProtectedMediaRoutes(app: FastifyInstance, config: AppConfig, db: Database, hub: RealtimeHub) {
  const authenticate = createAuthenticator(config);
  // The audit chain is keyed so database access alone cannot forge it. Falls back to a key derived from the JWT secret.
  setAuditKey(config.PROTECTED_MEDIA_AUDIT_SECRET
    ?? createHmac("sha256", config.JWT_HS256_SECRET).update("linqa/protected-media/audit/v1").digest("hex"));
  const media = new ProtectedMediaService(db, hub);

  const timer = setInterval(() => {
    media.sweep().catch((error) => app.log.error({ err: error }, "protected media sweep failed"));
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));

  // Encapsulated so the raw-bytes parser stays local to these routes.
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_CIPHERTEXT_BYTES },
      (_request, body, done) => done(null, body));

    async function handle<T>(request: FastifyRequest, reply: FastifyReply, work: (userId: string) => Promise<T>) {
      let userId: string;
      try {
        userId = (await authenticate(request)).userId;
      } catch {
        return reply.code(401).send({ message: "Sign in again." });
      }
      const { id, viewId } = (request.params ?? {}) as { id?: string; viewId?: string };
      if ((id !== undefined && !UUID.test(id)) || (viewId !== undefined && !UUID.test(viewId))) {
        return reply.code(404).send({ message: "Not found." });
      }
      try {
        return await work(userId);
      } catch (error) {
        if (error instanceof MediaHttpError) {
          return reply.code(error.status).send({ message: error.message, ...(error.mediaStatus ? { status: error.mediaStatus } : {}) });
        }
        request.log.error({ err: error }, "protected media request failed");
        return reply.code(500).send({ message: "Something went wrong." });
      }
    }

    scope.post("/v1/protected-media", async (request, reply) => handle(request, reply, async (userId) => {
      const query = request.query as { recipientId?: string; conversationId?: string; policy?: string };
      const body = Buffer.isBuffer(request.body) ? request.body : undefined;
      return media.create(userId, { recipientId: query.recipientId, conversationId: query.conversationId, policy: query.policy }, body);
    }));

    scope.get("/v1/protected-media/:id", async (request, reply) => handle(request, reply, (userId) =>
      media.getStatus((request.params as { id: string }).id, userId)));

    scope.post("/v1/protected-media/:id/views", async (request, reply) => handle(request, reply, (userId) =>
      media.requestView((request.params as { id: string }).id, userId, (request.body as { client?: unknown } | null)?.client)));

    scope.get("/v1/protected-media/:id/views/:viewId/blob", async (request, reply) => handle(request, reply, async (userId) => {
      const { id, viewId } = request.params as { id: string; viewId: string };
      const bytes = await media.fetchCiphertext(id, viewId, userId, (request.query as { token?: unknown }).token);
      return reply
        .header("Content-Type", "application/octet-stream")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(bytes);
    }));

    scope.post("/v1/protected-media/:id/views/:viewId/end", async (request, reply) => handle(request, reply, (userId) => {
      const { id, viewId } = request.params as { id: string; viewId: string };
      return media.endView(id, viewId, userId, (request.body as { reason?: unknown } | null)?.reason);
    }));

    scope.post("/v1/protected-media/:id/capture", async (request, reply) => handle(request, reply, (userId) => {
      const body = (request.body ?? {}) as { kind?: unknown; viewId?: unknown; client?: unknown };
      return media.reportCapture((request.params as { id: string }).id, userId, body.kind, body.viewId, body.client);
    }));

    scope.post("/v1/protected-media/:id/revoke", async (request, reply) => handle(request, reply, (userId) =>
      media.revoke((request.params as { id: string }).id, userId)));

    scope.get("/v1/protected-media/:id/audit", async (request, reply) => handle(request, reply, (userId) =>
      media.getAudit((request.params as { id: string }).id, userId)));
  });
}

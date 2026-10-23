import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { AppConfig } from "../config.js";
import type { ModulesService } from "../services/modules.service.js";

// Content is sealed on the phone. 400k base64 characters is roughly 300 KB of ciphertext, above the app's own note size cap.
const sealed = z.string().min(24).max(400_000).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const id = z.object({ id: z.string().uuid() });
const orgId = z.object({ orgId: z.string().uuid() });
const bytes = (value: string) => Buffer.from(value, "base64");

const KNOWN: Record<string, number> = { ORGANIZATION_NOT_FOUND: 404, ADMIN_REQUIRED: 403, INVALID_EVENT_TIME: 400 };

/**
 * Read, update and delete for the encrypted Notes and Calendar that /v2/notes and /v2/calendar/events create, plus read-only
 * Enterprise views. The server never sees note or event content, only ciphertext, and every route is scoped to the signed-in
 * account. Enterprise roles and policies are changed by the admin system, not from here.
 */
export async function registerModulesRoutes(app: FastifyInstance, config: AppConfig, modules: ModulesService) {
  const authenticate = createAuthenticator(config);

  const guarded = (scope: string, work: (request: FastifyRequest, userId: string, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      let principal;
      try { principal = await authenticate(request); requireScope(principal, scope); } catch { return reply.code(401).send({ error: "unauthorized" }); }
      reply.header("cache-control", "no-store");
      try { return await work(request, principal.userId, reply); }
      catch (error) {
        if (error instanceof ZodError) return reply.code(400).send({ error: "invalid_request" });
        const code = error instanceof Error ? error.message : "";
        const status = KNOWN[code];
        if (status !== undefined) return reply.code(status).send({ error: code });
        request.log.error({ err: error }, "modules request failed");
        return reply.code(503).send({ error: "modules_unavailable" });
      }
    };
  const missing = (reply: FastifyReply, error: string) => reply.code(404).send({ error });

  // Notes
  app.get("/v2/notes", guarded("notes:read", async (_r, userId) => ({ items: await modules.listNotes(userId) })));
  app.put("/v2/notes/:id", guarded("notes:write", async (request, userId, reply) => {
    const { id: noteId } = id.parse(request.params);
    const body = z.object({ ciphertextBase64: sealed }).strict().parse(request.body);
    return (await modules.replaceNote(userId, noteId, bytes(body.ciphertextBase64))) ?? missing(reply, "NOTE_NOT_FOUND");
  }));
  app.delete("/v2/notes/:id", guarded("notes:write", async (request, userId, reply) => {
    const { id: noteId } = id.parse(request.params);
    return (await modules.deleteNote(userId, noteId)) ? reply.code(204).send() : missing(reply, "NOTE_NOT_FOUND");
  }));

  // Calendar
  app.get("/v2/calendar/events", guarded("calendar:read", async (request, userId) => {
    const q = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }).strict().parse(request.query);
    return { items: await modules.listEvents(userId, { ...(q.from ? { from: new Date(q.from) } : {}), ...(q.to ? { to: new Date(q.to) } : {}) }) };
  }));
  app.put("/v2/calendar/events/:id", guarded("calendar:write", async (request, userId, reply) => {
    const { id: eventId } = id.parse(request.params);
    const body = z.object({ titleCiphertextBase64: sealed.optional(), descriptionCiphertextBase64: sealed.optional(), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional() })
      .strict().refine((b) => Object.keys(b).length > 0).parse(request.body);
    const updated = await modules.updateEvent(userId, eventId, {
      ...(body.titleCiphertextBase64 ? { titleCiphertext: bytes(body.titleCiphertextBase64) } : {}),
      ...(body.descriptionCiphertextBase64 ? { descriptionCiphertext: bytes(body.descriptionCiphertextBase64) } : {}),
      ...(body.startsAt ? { startsAt: new Date(body.startsAt) } : {}), ...(body.endsAt ? { endsAt: new Date(body.endsAt) } : {})
    });
    return updated ?? missing(reply, "EVENT_NOT_FOUND");
  }));
  app.delete("/v2/calendar/events/:id", guarded("calendar:write", async (request, userId, reply) => {
    const { id: eventId } = id.parse(request.params);
    return (await modules.deleteEvent(userId, eventId)) ? reply.code(204).send() : missing(reply, "EVENT_NOT_FOUND");
  }));

  // Enterprise (read-only). Membership is checked in the service; the scope only says the app may ask.
  app.get("/v2/enterprise/organizations", guarded("enterprise:read", async (_r, userId) => ({ items: await modules.organizations(userId) })));
  app.get("/v2/enterprise/organizations/:orgId", guarded("enterprise:read", async (request, userId) => modules.organization(orgId.parse(request.params).orgId, userId)));
  app.get("/v2/enterprise/organizations/:orgId/directory", guarded("enterprise:read", async (request, userId) => ({ items: await modules.directory(orgId.parse(request.params).orgId, userId) })));
  app.get("/v2/enterprise/organizations/:orgId/policies", guarded("enterprise:read", async (request, userId) => ({ items: await modules.policies(orgId.parse(request.params).orgId, userId) })));
  app.get("/v2/enterprise/organizations/:orgId/audit-log", guarded("enterprise:read", async (request, userId) => ({ items: await modules.auditLog(orgId.parse(request.params).orgId, userId) })));
}

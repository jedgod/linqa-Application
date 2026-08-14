import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { TrustSafetyService } from "../services/trust-safety.service.js";

export async function registerSafetyRoutes(
  app: FastifyInstance,
  config: AppConfig,
  safety: TrustSafetyService
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/safety/blocks", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "safety:write");

      const body = z.object({
        blockedUserId: z.string().uuid(),
        reason: z.string().max(500).optional()
      }).parse(request.body);

      await safety.block({
        blockerUserId: principal.userId,
        blockedUserId: body.blockedUserId,
        ...(body.reason !== undefined ? { reason: body.reason } : {})
      });

      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "safety block rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/safety/reports", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "safety:write");

      const body = z.object({
        reportedUserId: z.string().uuid().optional(),
        callId: z.string().uuid().optional(),
        category: z.enum([
          "HARASSMENT",
          "IMPERSONATION",
          "THREATS",
          "SCAM",
          "SEXUAL_CONTENT",
          "HATE",
          "MINOR_SAFETY",
          "OTHER"
        ]),
        description: z.string().min(10).max(5000),
        evidenceAttachmentId: z.string().uuid().optional()
      }).parse(request.body);

      const { reportedUserId, callId, evidenceAttachmentId, ...rest } = body;
      const report = await safety.submitReport({
        reporterUserId: principal.userId,
        ...(reportedUserId !== undefined ? { reportedUserId } : {}),
        ...(callId !== undefined ? { callId } : {}),
        ...(evidenceAttachmentId !== undefined ? { evidenceAttachmentId } : {}),
        ...rest
      });

      return reply.code(201).send(report);
    } catch (error) {
      request.log.warn({ err: error }, "safety report rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}

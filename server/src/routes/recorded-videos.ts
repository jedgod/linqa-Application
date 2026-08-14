import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { RecordedVideoService } from "../services/recorded-video.service.js";

export async function registerRecordedVideoRoutes(
  app: FastifyInstance,
  config: AppConfig,
  recordedVideos: RecordedVideoService
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/recorded-videos", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:write");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const body = z.object({
        recipientUserId: z.string().uuid(),
        // The recorded video bytes must already be uploaded through the
        // normal attachment multipart-upload flow (POST /v1/attachments,
        // then completed) before this route is called; this binds the
        // disclosure metadata to that verified, owner-scoped object.
        attachmentId: z.string().uuid(),
        ciphertextSize: z.number().int().positive(),
        durationSeconds: z.number().int().positive().max(600),
        recordedAt: z.string().datetime(),
        retentionPolicy: z.enum([
          "VIEW_ONCE",
          "DELETE_AFTER_VIEW",
          "DELETE_24_HOURS",
          "DELETE_7_DAYS",
          "KEEP"
        ])
      }).parse(request.body);

      const created = await recordedVideos.create({
        ownerUserId: principal.userId,
        ownerDeviceId: principal.deviceId,
        recipientUserId: body.recipientUserId,
        attachmentId: body.attachmentId,
        ciphertextSize: body.ciphertextSize,
        durationSeconds: body.durationSeconds,
        recordedAt: new Date(body.recordedAt),
        retentionPolicy: body.retentionPolicy
      });

      return reply.code(201).send(created);
    } catch (error) {
      request.log.warn({ err: error }, "recorded video registration rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/recorded-videos/:assetId/viewed", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "calls:write");

      const params = z.object({ assetId: z.string().uuid() }).parse(request.params);
      await recordedVideos.markViewed(params.assetId, principal.userId);

      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "recorded video view rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}

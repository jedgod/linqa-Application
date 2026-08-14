import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { AttachmentService } from "../services/attachment.service.js";
import type { KillSwitchService } from "../services/kill-switch.service.js";

export async function registerAttachmentRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  attachments: AttachmentService,
  killSwitches: KillSwitchService
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/attachments", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "attachments:write");
      await killSwitches.assertEnabledOperation("attachment_upload_disabled");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const body = z.object({
        mediaType: z.enum(["IMAGE", "VIDEO", "VOICE_NOTE", "DOCUMENT", "LINK", "FILE"]),
        ciphertextSize: z.number().int().positive(),
        chunkCount: z.number().int().min(1).max(10_000),
        manifestHashBase64: z.string().min(40).max(100)
      }).parse(request.body);

      const created = await attachments.createUpload({
        userId: principal.userId,
        deviceId: principal.deviceId,
        mediaType: body.mediaType,
        ciphertextSize: body.ciphertextSize,
        chunkCount: body.chunkCount,
        manifestHash: Buffer.from(body.manifestHashBase64, "base64")
      });

      return reply.code(201).send(created);
    } catch (error) {
      request.log.warn({ err: error }, "attachment upload creation rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/attachments/:attachmentId/parts/:partNumber", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "attachments:write");
      const params = z.object({
        attachmentId: z.string().uuid(),
        partNumber: z.coerce.number().int().positive()
      }).parse(request.params);
      const body = z.object({ uploadId: z.string().min(1).max(1000) }).parse(request.body);
      return await attachments.signPart(
        principal.userId,
        params.attachmentId,
        body.uploadId,
        params.partNumber
      );
    } catch (error) {
      request.log.warn({ err: error }, "attachment part signing rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/attachments/:attachmentId/complete", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "attachments:write");
      const params = z.object({ attachmentId: z.string().uuid() }).parse(request.params);
      const body = z.object({
        uploadId: z.string().min(1).max(1000),
        parts: z.array(z.object({
          partNumber: z.number().int().positive(),
          etag: z.string().min(1).max(1000)
        })).min(1).max(10_000)
      }).parse(request.body);
      await attachments.complete({
        userId: principal.userId,
        attachmentId: params.attachmentId,
        uploadId: body.uploadId,
        parts: body.parts
      });
      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "attachment completion rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}

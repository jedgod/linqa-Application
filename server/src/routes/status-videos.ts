import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { MAX_STATUS_VIDEO_DEVICES, MAX_STATUS_VIDEO_HOURS, MAX_STATUS_VIDEO_SECONDS, StatusVideoError, type StatusVideoService } from "../services/status-video.service.js";

/**
 * Encrypted video posts to status. Posting needs `status:write`; watching needs `status:react` (the scope viewers already hold),
 * so phones enrolled before this feature need no re-enrollment. Every route is bound to the calling DEVICE, because the sealed key
 * bundle a recipient receives is for one device only.
 *
 * Answers are deliberately uninformative: a post that does not exist, has expired, was taken down, or was never addressed to this
 * device all return the same 404, and audience failures never say which person was refused (that would reveal blocks).
 */
export async function registerStatusVideoRoutes(app: FastifyInstance, config: AppConfig, statusVideos: StatusVideoService) {
  const authenticate = createAuthenticator(config);

  const deviceBound = async (request: Parameters<typeof authenticate>[0], scope: string) => {
    const principal = await authenticate(request);
    requireScope(principal, scope);
    if (!principal.deviceId) throw new StatusVideoError("not_found");
    return { userId: principal.userId, deviceId: principal.deviceId };
  };

  const fail = (request: { log: { warn: (o: object, m: string) => void } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }, error: unknown) => {
    request.log.warn({ err: error }, "status video request rejected");
    if (error instanceof StatusVideoError) {
      return error.code === "not_found" ? reply.code(404).send({ error: "not_found" }) : reply.code(422).send({ error: error.code });
    }
    return reply.code(400).send({ error: "invalid_request" });
  };

  app.post("/v1/status-videos", async (request, reply) => {
    try {
      const me = await deviceBound(request, "status:write");
      const body = z.object({
        // The ciphertext must already be uploaded and completed through POST /v1/attachments (mediaType VIDEO).
        attachmentId: z.string().uuid(),
        kind: z.enum(["VIDEO", "PODCAST"]).default("VIDEO"),
        durationSeconds: z.number().int().min(1).max(MAX_STATUS_VIDEO_SECONDS),
        ciphertextSize: z.number().int().positive(),
        expiresInHours: z.number().int().min(1).max(MAX_STATUS_VIDEO_HOURS).optional(),
        recipients: z.array(z.object({
          userId: z.string().uuid(),
          deviceId: z.string().uuid(),
          sealedKey: z.string().min(1).max(65536)
        })).min(1).max(MAX_STATUS_VIDEO_DEVICES)
      }).strict().parse(request.body);
      const created = await statusVideos.create({ ownerUserId: me.userId, ownerDeviceId: me.deviceId, ...body });
      return reply.code(201).send(created);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get("/v1/status-videos/feed", async (request, reply) => {
    try {
      const me = await deviceBound(request, "status:react");
      return { items: await statusVideos.feed(me.userId, me.deviceId) };
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.get("/v1/status-videos/mine", async (request, reply) => {
    try {
      const me = await deviceBound(request, "status:write");
      return { items: await statusVideos.mine(me.userId) };
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post("/v1/status-videos/:postId/download", async (request, reply) => {
    try {
      const me = await deviceBound(request, "status:react");
      const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
      return await statusVideos.signDownload(me.userId, me.deviceId, postId);
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.post("/v1/status-videos/:postId/viewed", async (request, reply) => {
    try {
      const me = await deviceBound(request, "status:react");
      const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
      await statusVideos.markViewed(me.userId, me.deviceId, postId);
      return reply.code(204).send();
    } catch (error) {
      return fail(request, reply, error);
    }
  });

  app.delete("/v1/status-videos/:postId", async (request, reply) => {
    try {
      const me = await deviceBound(request, "status:write");
      const { postId } = z.object({ postId: z.string().uuid() }).parse(request.params);
      await statusVideos.remove(me.userId, postId);
      return reply.code(204).send();
    } catch (error) {
      return fail(request, reply, error);
    }
  });
}

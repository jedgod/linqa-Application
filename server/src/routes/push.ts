import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { PushService } from "../services/push.service.js";

export async function registerPushRoutes(
  app: FastifyInstance,
  config: AppConfig,
  push: PushService
) {
  const authenticate = createAuthenticator(config);

  app.put("/v1/push/endpoints/current", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "push:write");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const body = z.object({
        provider: z.enum(["APNS", "FCM", "WEB_PUSH"]),
        token: z.string().min(16).max(4096),
        appBundle: z.string().min(3).max(255),
        environment: z.enum(["DEVELOPMENT", "PRODUCTION"])
      }).parse(request.body);

      await push.register({
        userId: principal.userId,
        deviceId: principal.deviceId,
        ...body
      });

      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "push registration rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator } from "../auth/jwt.js";
import type { ProtocolCapabilityService } from "../services/protocol-capability.service.js";

export async function registerProtocolCapabilityRoutes(
  app: FastifyInstance,
  config: AppConfig,
  capabilities: ProtocolCapabilityService
) {
  const authenticate = createAuthenticator(config);

  app.put("/v1/devices/capabilities", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const body = z.object({
        protocolMin: z.number().int().min(1),
        protocolMax: z.number().int().min(1),
        capabilities: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
        coreVersion: z.string().min(1).max(50)
      }).parse(request.body);

      await capabilities.publish({
        deviceId: principal.deviceId,
        ...body
      });

      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "protocol capability publish rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { ContactDiscoveryService } from "../services/contact-discovery.service.js";

export async function registerContactDiscoveryRoutes(
  app: FastifyInstance,
  config: AppConfig,
  discovery: ContactDiscoveryService
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/contact-discovery/query", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "contacts:discover");

      if (!principal.deviceId) {
        return reply.code(401).send({ error: "device_bound_token_required" });
      }

      const body = z.object({
        tokens: z.array(z.object({
          type: z.enum(["PHONE", "EMAIL"]),
          tokenBase64: z.string().min(40).max(100)
        })).min(1).max(500)
      }).parse(request.body);

      const matches = await discovery.discover({
        userId: principal.userId,
        deviceId: principal.deviceId,
        tokens: body.tokens.map((token) => ({
          type: token.type,
          token: Buffer.from(token.tokenBase64, "base64")
        }))
      });

      return { userIds: matches };
    } catch (error) {
      request.log.warn({ err: error }, "contact discovery query rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}

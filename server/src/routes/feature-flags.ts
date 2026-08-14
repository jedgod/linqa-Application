import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator } from "../auth/jwt.js";
import type { FeatureFlagService } from "../services/feature-flag.service.js";

export async function registerFeatureFlagRoutes(
  app: FastifyInstance,
  config: AppConfig,
  flags: FeatureFlagService
) {
  const authenticate = createAuthenticator(config);

  app.get("/v1/feature-flags/:key", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      const params = z.object({ key: z.string().min(1).max(100) }).parse(request.params);
      const query = z.object({ appVersion: z.string().max(30).optional() }).parse(request.query);

      const enabled = await flags.enabled(params.key, principal.userId, query.appVersion);
      return { key: params.key, enabled };
    } catch (error) {
      request.log.warn({ err: error }, "feature flag lookup rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}

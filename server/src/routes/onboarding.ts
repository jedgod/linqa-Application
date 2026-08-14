import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { createAuthenticator } from "../auth/jwt.js";
import type { OnboardingService } from "../services/onboarding.service.js";

export async function registerOnboardingRoutes(app: FastifyInstance, config: AppConfig, onboarding: OnboardingService) {
  const authenticate = createAuthenticator(config);
  app.get("/v1/onboarding/status", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      return await onboarding.status(principal.userId, principal.deviceId);
    } catch (error) {
      request.log.warn({ err: error }, "onboarding status rejected");
      return reply.code(401).send({ error: "unauthenticated" });
    }
  });
}

import { z } from "zod";
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
  app.get("/v1/onboarding/profile", async (request, reply) => {
    let principal;
    try { principal = await authenticate(request); }
    catch { return reply.code(401).send({ error: "unauthenticated" }); }
    return onboarding.profile(principal.userId);
  });
  app.post("/v1/onboarding/profile", async (request, reply) => {
    let principal;
    try { principal = await authenticate(request); }
    catch { return reply.code(401).send({ error: "unauthenticated" }); }
    const parsed = z.object({
      fullName: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/u),
      stageName: z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/u)
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_profile", message: "Enter a name and stage name, each between 1 and 100 characters." });
    try {
      return await onboarding.saveProfile(principal.userId, principal.deviceId, parsed.data.fullName, parsed.data.stageName);
    } catch (error) {
      if (error instanceof Error && error.message === "profile_setup_not_allowed") return reply.code(403).send({ error: "profile_setup_not_allowed" });
      request.log.error({ err: error }, "profile setup failed");
      return reply.code(500).send({ error: "profile_setup_failed" });
    }
  });
  app.post("/v1/onboarding/complete", async (request, reply) => {
    let principal;
    try {
      principal = await authenticate(request);
    } catch (error) {
      request.log.warn({ err: error }, "onboarding completion authentication rejected");
      return reply.code(401).send({ error: "unauthenticated" });
    }
    try {
      return await onboarding.acknowledgeCompletion(principal.userId, principal.deviceId);
    } catch (error) {
      request.log.warn({ err: error }, "onboarding completion acknowledgment rejected");
      return reply.code(409).send({ error: "onboarding_not_complete" });
    }
  });
}

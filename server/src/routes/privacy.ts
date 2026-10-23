import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { PrivacySettingsService } from "../services/privacy-settings.service.js";

const Visibility = z.enum(["EVERYONE", "CONTACTS", "NOBODY"]);

export async function registerPrivacyRoutes(
  app: FastifyInstance,
  config: AppConfig,
  privacy: PrivacySettingsService
) {
  const authenticate = createAuthenticator(config);

  app.get("/v1/privacy/settings", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "privacy:read");
      reply.header("cache-control", "no-store");
      return await privacy.get(principal.userId);
    } catch (error) {
      request.log.warn({ err: error }, "privacy settings read rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.put("/v1/privacy/settings", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      // A device token carries privacy:write; profile:write (the older requirement) is still accepted.
      requireScope(principal, principal.scopes.has("profile:write") ? "profile:write" : "privacy:write");

      const body = z.object({
        profileVisibility: Visibility,
        phoneDiscoverability: z.boolean(),
        emailDiscoverability: z.boolean(),
        usernameDiscoverability: z.boolean(),
        readReceipts: z.boolean(),
        typingIndicators: z.boolean(),
        lastSeenVisibility: Visibility
      }).parse(request.body);

      await privacy.update(principal.userId, body);
      return reply.code(204).send();
    } catch (error) {
      request.log.warn({ err: error }, "privacy settings update rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}

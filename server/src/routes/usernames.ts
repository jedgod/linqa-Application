import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { UsernameService } from "../services/username.service.js";

export async function registerUsernameRoutes(
  app: FastifyInstance,
  config: AppConfig,
  usernames: UsernameService
) {
  const authenticate = createAuthenticator(config);

  app.put("/v1/profile/username", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "profile:write");

      const body = z.object({
        username: z.string().min(3).max(30)
      }).parse(request.body);

      const result = await usernames.change(principal.userId, body.username);
      return reply.send(result);
    } catch (error) {
      request.log.warn({ err: error }, "username change rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}

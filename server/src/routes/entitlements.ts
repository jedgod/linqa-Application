import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { createAuthenticator } from "../auth/jwt.js";
import type { EntitlementService } from "../services/entitlement.service.js";

export async function registerEntitlementRoutes(
  app: FastifyInstance,
  config: AppConfig,
  entitlements: EntitlementService
) {
  const authenticate = createAuthenticator(config);

  app.get("/v1/entitlements", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      const rows = await entitlements.list(principal.userId);

      return {
        entitlements: rows.map((row) => ({
          key: row.entitlement_key,
          enabled: row.enabled,
          source: row.source,
          expiresAt: row.expires_at
        }))
      };
    } catch (error) {
      request.log.warn({ err: error }, "entitlement lookup rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });
}

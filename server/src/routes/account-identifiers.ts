import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator } from "../auth/jwt.js";
import type { AuthChallengeService } from "../services/auth-challenge.service.js";

// Recovery email is deliberately not a new subsystem: it's a second,
// non-primary, verified EMAIL row in the existing generic
// `account_identifiers` table, verified through the existing generic
// AuthChallengeService (same OTP machinery /v1/auth/challenges already
// uses), with purpose ADD_IDENTIFIER.
export async function registerAccountIdentifierRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  challengeService: AuthChallengeService
) {
  const auth = createAuthenticator(config);

  app.post("/v1/account/recovery-email", async (request, reply) => {
    const p = await auth(request);

    try {
      const body = z.object({ email: z.string().email().max(254) }).parse(request.body);
      const normalized = body.email.trim().toLowerCase();

      const challenge = await challengeService.create({
        identifierType: "EMAIL",
        normalizedIdentifier: normalized,
        purpose: "ADD_IDENTIFIER",
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown"
      });

      return reply.code(202).send({
        status: "accepted",
        challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt
      });
    } catch (error) {
      request.log.warn({ err: error, userId: p.userId }, "recovery email request rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/account/recovery-email/verify", async (request, reply) => {
    const p = await auth(request);

    try {
      const body = z
        .object({
          challengeId: z.string().uuid(),
          code: z.string().regex(/^\d{6}$/)
        })
        .parse(request.body);

      const verified = await challengeService.verify(body);
      if (verified.identifierType !== "EMAIL") {
        return reply.code(400).send({ error: "invalid_request" });
      }

      await db.query(
        `INSERT INTO account_identifiers (user_id, type, normalized_value, display_value, is_primary, verified_at)
         VALUES ($1, 'EMAIL', $2, $2, false, now())`,
        [p.userId, verified.normalizedIdentifier]
      );

      return reply.send({ linked: true, email: verified.normalizedIdentifier });
    } catch (error: any) {
      if (error?.code === "23505") {
        return reply.code(409).send({ error: "email_already_linked_elsewhere" });
      }
      request.log.warn({ err: error, userId: p.userId }, "recovery email verification rejected");
      return reply.code(400).send({ error: "invalid_or_expired_code" });
    }
  });
}

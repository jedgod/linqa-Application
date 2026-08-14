import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { normalizeIdentifier } from "../auth/normalize.js";
import { AuthChallengeService } from "../services/auth-challenge.service.js";
import { SessionService } from "../services/session.service.js";
import { hashIp, sha256 } from "../security/hash.js";

export interface AuthRouteDependencies {
  challengeService: AuthChallengeService;
  sessionService: SessionService;
}

export const PRE_ENROLLMENT_SCOPES = ["profile:read", "devices:read"] as const;

export function isAuthenticationPurpose(purpose: string): boolean {
  return purpose === "LOGIN" || purpose === "REGISTRATION";
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  deps: AuthRouteDependencies
) {
  app.post("/v1/auth/challenges", async (request, reply) => {
    try {
      const body = z.object({
        identifier: z.string().min(3).max(320),
        purpose: z.enum([
          "REGISTRATION",
          "LOGIN",
          "ADD_IDENTIFIER",
          "RECOVERY",
          "HIGH_RISK_ACTION"
        ])
      }).parse(request.body);

      const identifier = normalizeIdentifier(body.identifier);

      const challenge = await deps.challengeService.create({
        identifierType: identifier.type,
        normalizedIdentifier: identifier.normalized,
        purpose: body.purpose,
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? "unknown"
      });

      // challengeId is an opaque, single-use handle for this verification
      // attempt — it does not reveal whether the identifier has an account,
      // so returning it does not weaken the anti-enumeration response below.
      // Without it no client could ever reach /v1/auth/challenges/verify.
      return reply.code(202).send({
        status: "accepted",
        message: "If the identifier can receive a code, one has been sent.",
        challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt,
        resendAfter: challenge.resendAfter
      });
    } catch (error) {
      request.log.warn({ err: error }, "auth challenge request rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/auth/challenges/verify", async (request, reply) => {
    try {
      const body = z.object({
        challengeId: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/)
      }).parse(request.body);

      const verified = await deps.challengeService.verify(body);

      if (!isAuthenticationPurpose(verified.purpose)) {
        request.log.warn({ purpose: verified.purpose }, "challenge purpose cannot create a login session");
        return reply.code(400).send({ error: "invalid_challenge_purpose" });
      }

      const identifier = await db.query(
        `SELECT ai.*, u.external_subject
         FROM account_identifiers ai
         JOIN users u ON u.id = ai.user_id
         WHERE ai.type = $1
           AND ai.normalized_value = $2
           AND ai.verified_at IS NOT NULL
           AND ai.disabled_at IS NULL`,
        [verified.identifierType, verified.normalizedIdentifier]
      );

      if (identifier.rowCount === 1) {
        const row = identifier.rows[0];
        const session = await deps.sessionService.create({
          userId: row.user_id,
          subject: row.external_subject,
          scopes: [...PRE_ENROLLMENT_SCOPES],
          ipHash: hashIp(config.IP_HASH_SECRET ?? config.CONTACT_DISCOVERY_SECRET, request.ip),
          userAgentHash: sha256(request.headers["user-agent"] ?? "unknown")
        });

        return {
          accountExists: true,
          authenticationRequired: "DEVICE_ENROLLMENT_OR_PASSKEY",
          temporarySession: session
        };
      }

      return {
        accountExists: false,
        registrationRequired: true,
        verifiedIdentifier: {
          type: verified.identifierType,
          value: verified.normalizedIdentifier
        }
      };
    } catch (error) {
      request.log.warn({ err: error }, "challenge verification rejected");
      return reply.code(400).send({ error: "invalid_or_expired_code" });
    }
  });

  // Consumes a REGISTRATION-purpose challenge that /v1/auth/challenges/verify
  // already proved (its code was single-use and is now spent) and that came
  // back with registrationRequired:true, i.e. no account exists yet for that
  // identifier. This is the only real path that creates a `users` row today
  // — every other route (device-enrollment, multi-account, calls, ...)
  // requires an already-authenticated principal.
  app.post("/v1/auth/register", async (request, reply) => {
    try {
      const body = z.object({ challengeId: z.string().uuid() }).parse(request.body);

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const challengeResult = await client.query(
          `SELECT * FROM authentication_challenges
           WHERE id = $1
             AND purpose = 'REGISTRATION'
             AND consumed_at IS NOT NULL
             AND consumed_at > now() - interval '10 minutes'
           FOR UPDATE`,
          [body.challengeId]
        );
        const challenge = challengeResult.rows[0];
        if (!challenge) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "unverified_or_expired_registration" });
        }
        if (config.NODE_ENV === "production" && challenge.identifier_type !== "PHONE") {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "phone_first_registration_required" });
        }

        const existing = await client.query(
          `SELECT 1 FROM account_identifiers WHERE type = $1 AND normalized_value = $2`,
          [challenge.identifier_type, challenge.normalized_identifier]
        );
        if ((existing.rowCount ?? 0) > 0) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "account_already_registered" });
        }

        const subject = `linqa-user-${randomUUID()}`;
        const user = await client.query(
          `INSERT INTO users (id, external_subject, status) VALUES (gen_random_uuid(), $1, 'ACTIVE') RETURNING id`,
          [subject]
        );
        const userId = user.rows[0].id as string;

        await client.query(
          `INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Linqa User')
           ON CONFLICT (user_id) DO NOTHING`,
          [userId]
        );

        await client.query(
          `INSERT INTO account_identifiers (user_id, type, normalized_value, display_value, is_primary, verified_at)
           VALUES ($1, $2, $3, $3, true, now())`,
          [userId, challenge.identifier_type, challenge.normalized_identifier]
        );

        await client.query("COMMIT");

        const session = await deps.sessionService.create({
          userId,
          subject,
          scopes: [...PRE_ENROLLMENT_SCOPES],
          ipHash: hashIp(config.IP_HASH_SECRET ?? config.CONTACT_DISCOVERY_SECRET, request.ip),
          userAgentHash: sha256(request.headers["user-agent"] ?? "unknown")
        });

        return reply.code(201).send({
          accountCreated: true,
          authenticationRequired: "DEVICE_ENROLLMENT_OR_PASSKEY",
          temporarySession: session
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      request.log.warn({ err: error }, "registration rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post("/v1/auth/sessions/refresh", async (request, reply) => {
    const body = z.object({
      refreshToken: z.string().min(40)
    }).parse(request.body);

    try {
      return await deps.sessionService.rotate({
        refreshToken: body.refreshToken
      });
    } catch {
      return reply.code(401).send({ error: "invalid_refresh_token" });
    }
  });
}

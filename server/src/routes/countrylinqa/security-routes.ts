import { publicCountryError } from "./public-error.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { Database } from "../../db/pool.js";
import { StepUpService } from "../../services/countrylinqa/security/step-up.js";
import { antiEnumeration } from "../../services/countrylinqa/security/anti-enumeration.js";
import type { CountryReverificationService } from "../../services/countrylinqa/final/reverify.js";

function withErrors<T>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: "validation_error", details: error.flatten() });
      }
      const { status, code } = publicCountryError(error);
      request.log.warn({ err: error }, "countrylinqa security request rejected");
      return reply.code(status).send({ error: code });
    }
  };
}

const PURPOSES = ["COUNTRY_CHANGE", "PHONE_CHANGE", "GLOBAL_ENABLE", "BUSINESS_TARGET_CHANGE"] as const;

export async function registerCountryLinqaSecurityRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  reverification: CountryReverificationService
) {
  const auth = createAuthenticator(config);
  const stepUp = new StepUpService(db);
  const throttle = antiEnumeration();

  app.post(
    "/v1/countrylinqa/security/stepup/challenge",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      await throttle(db, p.userId, request);

      const body = z.object({ purpose: z.enum(PURPOSES) }).parse(request.body);
      return stepUp.createChallenge(p.userId, body.purpose);
    })
  );

  app.post(
    "/v1/countrylinqa/security/stepup/consume",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      await throttle(db, p.userId, request);

      const body = z
        .object({ challengeId: z.string().uuid(), challenge: z.string().min(1), purpose: z.enum(PURPOSES) })
        .parse(request.body);
      await stepUp.consumeChallenge(p.userId, body.challengeId, body.challenge, body.purpose);
      return { ok: true };
    })
  );

  app.post(
    "/v1/countrylinqa/verification/reverify",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      await throttle(db, p.userId, request);

      const body = z
        .object({
          deviceId: z.string().min(1),
          stepUpChallengeId: z.string().uuid(),
          stepUpChallenge: z.string().min(1)
        })
        .parse(request.body);
      return reverification.reverify(p.userId, request.ip, body);
    })
  );
}

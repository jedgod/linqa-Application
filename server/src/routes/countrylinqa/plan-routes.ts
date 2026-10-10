import { publicCountryError } from "./public-error.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { Database } from "../../db/pool.js";
import { simpleRateLimit } from "../../services/countrylinqa/final/rate-limit.js";
import { CountryLinqaPlans, PAYMENT_METHODS, PlanError, unconfiguredPlanPayments, type PlanPaymentProvider } from "../../services/countrylinqa/plans.js";

/**
 * CountryLinqa Plans and Payments: compare plans, start a payment, read how it went, back out.
 * Nothing here activates a plan. Activation happens only when billing confirms through its webhook,
 * and the result screen reads that. With no payment provider connected, starting a payment ends in a
 * recorded failure and nobody is charged.
 */
export async function registerCountryLinqaPlanRoutes(app: FastifyInstance, config: AppConfig, db: Database, provider: PlanPaymentProvider = unconfiguredPlanPayments) {
  const auth = createAuthenticator(config);
  const plans = new CountryLinqaPlans(db, config, provider);
  const readLimit = simpleRateLimit({ windowMs: 60_000, max: 60, keyPrefix: "clq-plans-read" });
  const writeLimit = simpleRateLimit({ windowMs: 60 * 60_000, max: 20, keyPrefix: "clq-plans-write" });

  function guarded(scope: "countrylinqa:read" | "countrylinqa:write", limit: typeof readLimit, handler: (request: FastifyRequest, userId: string) => Promise<unknown>) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      let p;
      try { p = await auth(request); }
      catch { return reply.code(401).send({ error: "unauthorized" }); }
      try {
        requireScope(p, scope);
        limit(p.userId, request);
        return await handler(request, p.userId);
      } catch (error) {
        if (error instanceof z.ZodError) return reply.code(422).send({ error: "validation_error" });
        if (error instanceof PlanError) return reply.code(error.status).send({ error: error.code });
        const { status, code } = publicCountryError(error);
        request.log.warn({ err: error }, "countrylinqa plan request rejected");
        return reply.code(status).send({ error: code });
      }
    };
  }

  app.get("/v1/countrylinqa/plans", guarded("countrylinqa:read", readLimit, (_r, userId) => plans.list(userId)));

  app.post("/v1/countrylinqa/checkouts", guarded("countrylinqa:write", writeLimit, async (request, userId) => {
    const body = z.object({ planCode: z.enum(["PREMIUM", "ELITE"]), method: z.enum(PAYMENT_METHODS as [string, ...string[]]), idempotencyKey: z.string().min(8).max(100) }).strict().parse(request.body);
    return plans.createCheckout(userId, body as { planCode: string; method: (typeof PAYMENT_METHODS)[number]; idempotencyKey: string });
  }));

  app.get("/v1/countrylinqa/checkouts/:id", guarded("countrylinqa:read", readLimit, (request, userId) => plans.get(userId, z.object({ id: z.string().uuid() }).strict().parse(request.params).id)));

  app.post("/v1/countrylinqa/checkouts/:id/cancel", guarded("countrylinqa:write", writeLimit, (request, userId) => plans.cancel(userId, z.object({ id: z.string().uuid() }).strict().parse(request.params).id)));
}

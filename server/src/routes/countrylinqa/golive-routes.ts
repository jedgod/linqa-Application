import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { Database } from "../../db/pool.js";
import { getCountryFeed } from "../../services/countrylinqa/golive/feed.js";
import { discoverBusinesses } from "../../services/countrylinqa/golive/businessRanking.js";
import { discoverEvents } from "../../services/countrylinqa/golive/eventRanking.js";
import { recordRecommendationEvent } from "../../services/countrylinqa/golive/affinity.js";

function withErrors<T>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: "validation_error", details: error.flatten() });
      }
      const status = typeof error?.status === "number" ? error.status : 400;
      const code = typeof error?.code === "string" ? error.code : "invalid_request";
      request.log.warn({ err: error }, "countrylinqa golive request rejected");
      return reply.code(status).send({ error: code });
    }
  };
}

const recommendationEventSchema = z.object({
  candidateType: z.enum(["USER", "POST", "BUSINESS", "EVENT", "COMMUNITY"]),
  candidateId: z.string().uuid(),
  countryCode: z.string().length(2).optional(),
  regionCode: z.string().max(16).optional(),
  eventType: z.enum(["IMPRESSION", "OPEN", "LIKE", "FOLLOW", "JOIN", "HIDE", "BLOCK", "REPORT", "CONVERT"]),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export async function registerCountryLinqaGoLiveRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const auth = createAuthenticator(config);

  app.get(
    "/v1/countrylinqa/golive/feed",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        cursor: z.string().uuid().optional()
      }).parse(request.query);
      return getCountryFeed(db, p.userId, query.limit, query.cursor);
    })
  );

  app.get(
    "/v1/countrylinqa/golive/businesses",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
      return { items: await discoverBusinesses(db, p.userId, query.limit) };
    })
  );

  app.get(
    "/v1/countrylinqa/golive/events",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
      return { items: await discoverEvents(db, p.userId, query.limit) };
    })
  );

  app.post(
    "/v1/countrylinqa/golive/recommendation-events",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const body = recommendationEventSchema.parse(request.body);
      await recordRecommendationEvent(db, { userId: p.userId, ...body });
      return reply.code(204).send();
    })
  );
}

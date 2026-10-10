import { publicCountryError } from "./public-error.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { Database } from "../../db/pool.js";
import { getCountryFeed } from "../../services/countrylinqa/golive/feed.js";
import { discoverBusinesses } from "../../services/countrylinqa/golive/businessRanking.js";
import { discoverEvents } from "../../services/countrylinqa/golive/eventRanking.js";
import { recordRecommendationEvent } from "../../services/countrylinqa/golive/affinity.js";
import { collectionSearchSchema, pageItems } from "../../services/countrylinqa/search.js";
import { viewerScopeCte, authorScopePredicate, safetyPredicate } from "../../services/countrylinqa/feed-scope.js";
import { simpleRateLimit } from "../../services/countrylinqa/final/rate-limit.js";

function withErrors<T>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: "validation_error", details: error.flatten() });
      }
      const { status, code } = publicCountryError(error);
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

const createPostSchema = z.object({ body: z.string().trim().min(1).max(5000) });
const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  startsAt: z.coerce.date().refine((value) => value.getTime() > Date.now(), "event must start in the future"),
  city: z.string().trim().max(120).optional()
});

export async function registerCountryLinqaGoLiveRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const auth = createAuthenticator(config);
  const reportLimit = simpleRateLimit({ windowMs: 60_000, max: 20, keyPrefix: "countrylinqa-reports" });
  app.post("/v1/countrylinqa/reports", withErrors(async (request, reply) => {
    const p = await auth(request); requireScope(p,"countrylinqa:write"); reportLimit(p.userId,request);
    const body = z.object({ subjectType: z.enum(["USER","POST","EVENT","BUSINESS"]), subjectId: z.string().uuid(),
      reason: z.enum(["SPAM","FRAUD","ABUSE","OTHER"]), details: z.string().trim().max(1000).default("") }).strict().parse(request.body);
    // Only fixed enum values select SQL identifiers.
    const target = body.subjectType === "USER" ? "users content" : body.subjectType === "POST" ? "posts content" : body.subjectType === "EVENT" ? "events content" : "businesses content";
    const owner = body.subjectType === "USER" ? "content.id" : body.subjectType === "POST" ? "content.author_id" : "content.owner_user_id";
    const status = body.subjectType === "USER" || body.subjectType === "BUSINESS" ? "content.status='ACTIVE'" : "content.status='PUBLISHED'";
    const result = await db.query(`WITH ${viewerScopeCte(1)}
      INSERT INTO countrylinqa_moderation_queue(subject_type,subject_id,country_code,reason_code,evidence)
      SELECT $3,content.id,author.verified_country_code,$4,$5::jsonb FROM ${target}
      JOIN users author ON author.id=${owner} CROSS JOIN viewer_scope vs
      WHERE content.id=$2 AND ${status} AND ${authorScopePredicate("author")} AND ${safetyPredicate("author",1)} RETURNING id`,
      [p.userId,body.subjectId,body.subjectType,body.reason,JSON.stringify({ reporterUserId: p.userId,details: body.details })]);
    if (result.rowCount !== 1) return reply.code(404).send({ error: "CONTENT_UNAVAILABLE" });
    return reply.code(201).send({ reported: true, id: result.rows[0].id });
  }));


  app.get(
    "/v1/countrylinqa/golive/feed",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        cursor: z.string().uuid().optional(),
        q: z.string().trim().max(100).optional(),
        country: z.string().regex(/^[a-z]{2}$/i).transform(value => value.toUpperCase()).optional()
      }).parse(request.query);
      return getCountryFeed(db, p.userId, query.limit, query.cursor, query);
    })
  );

  app.post(
    "/v1/countrylinqa/golive/posts",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const body = createPostSchema.parse(request.body);
      const inserted = await db.query(
        `INSERT INTO posts (author_id,body,status,country_code,region_code)
         SELECT u.id,$2,'PUBLISHED',u.verified_country_code,c.region_code
         FROM users u JOIN countries c ON c.code=u.verified_country_code AND c.enabled=TRUE
         JOIN countrylinqa_country_status s ON s.country_code=c.code AND s.posting_enabled=TRUE
         WHERE u.id=$1 AND u.status='ACTIVE' AND u.country_verification_state='VERIFIED'
         RETURNING id,body,status,country_code AS "countryCode",region_code AS "regionCode",created_at AS "createdAt"`,
        [p.userId, body.body]
      );
      if (inserted.rowCount !== 1) return reply.code(403).send({ error: "COUNTRY_PUBLISHING_UNAVAILABLE" });
      return reply.code(201).send(inserted.rows[0]);
    })
  );

  app.post(
    "/v1/countrylinqa/golive/events",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const body = createEventSchema.parse(request.body);
      const inserted = await db.query(
        `INSERT INTO events (owner_user_id,title,starts_at,status,country_code,region_code,city)
         SELECT u.id,$2,$3,'PUBLISHED',u.verified_country_code,c.region_code,$4
         FROM users u JOIN countries c ON c.code=u.verified_country_code AND c.enabled=TRUE
         JOIN countrylinqa_country_status s ON s.country_code=c.code AND s.events_enabled=TRUE
         WHERE u.id=$1 AND u.status='ACTIVE' AND u.country_verification_state='VERIFIED'
         RETURNING id,title,starts_at AS "startsAt",status,country_code AS "countryCode",region_code AS "regionCode",city`,
        [p.userId, body.title, body.startsAt, body.city ?? null]
      );
      if (inserted.rowCount !== 1) return reply.code(403).send({ error: "COUNTRY_PUBLISHING_UNAVAILABLE" });
      return reply.code(201).send(inserted.rows[0]);
    })
  );

  app.get(
    "/v1/countrylinqa/golive/businesses",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      const query = collectionSearchSchema.parse(request.query);
      return pageItems(await discoverBusinesses(db, p.userId, query.limit, query), query);
    })
  );

  app.get(
    "/v1/countrylinqa/golive/events",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      const query = collectionSearchSchema.parse(request.query);
      return pageItems(await discoverEvents(db, p.userId, query.limit, query), query);
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

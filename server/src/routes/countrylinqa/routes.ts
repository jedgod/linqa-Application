import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { CountryLinqaService } from "../../services/countrylinqa/service.js";
import { discoverUsers } from "../../services/countrylinqa/discovery.js";
import { getFeedScope, viewerScopeCte, authorScopePredicate, safetyPredicate } from "../../services/countrylinqa/feed-scope.js";
import type { Database } from "../../db/pool.js";
import { discoverySearchSchema } from "../../services/countrylinqa/search.js";
import { simpleRateLimit } from "../../services/countrylinqa/final/rate-limit.js";

const countryCode = z.string().trim().length(2).transform((x) => x.toUpperCase());
const regionCode = z.string().trim().min(1).max(16).transform((x) => x.toUpperCase());

const updatePreferencesSchema = z.object({
  mode: z.enum(["MY_COUNTRY", "SELECTED_COUNTRIES", "REGION", "GLOBAL"]),
  selectedCountries: z.array(countryCode).max(250).default([]),
  selectedRegions: z.array(regionCode).max(50).default([]),
  locationPrecision: z.enum(["COUNTRY", "STATE", "CITY"]).optional(),
  showCity: z.boolean().optional(),
  inboundReach: z.enum(["MY_COUNTRY", "SELECTED_COUNTRIES", "REGION", "GLOBAL", "CONTACTS_ONLY"]).optional(),
  inboundSelectedCountries: z.array(countryCode).max(250).optional(),
  inboundSelectedRegions: z.array(regionCode).max(50).optional(),
  showCountry: z.boolean().optional(),
  showState: z.boolean().optional(),
  verifiedOnly: z.boolean().optional(),
  allowBusinesses: z.boolean().optional(),
  allowCommunities: z.boolean().optional(),
  allowEvents: z.boolean().optional(),
  paused: z.boolean().optional(),
  chatReach: z.object({
    mode: z.enum(["MY_COUNTRY", "SELECTED_COUNTRIES", "REGION", "WORLDWIDE", "EXISTING_CONTACTS_ONLY", "NOBODY"]),
    selectedCountries: z.array(countryCode).max(250).optional(),
    regionCode: regionCode.nullable().optional(),
    existingContactsBypass: z.boolean().optional()
  }).strict().optional(),
  activate: z.boolean().optional(),
  expectedVersion: z.number().int().min(1).optional()
});

const confirmCountrySchema = z.object({
  claimedCountryCode: countryCode,
  simCountryCode: countryCode.optional(),
  localeCountryCode: countryCode.optional()
});
const clarifyCountrySchema = z.object({ proposedCountryCode: countryCode.optional() });

/**
 * Every CountryLinqa service function throws plain Errors carrying
 * `.status`/`.code` (ported from the pack's convention). The app's global
 * Fastify error handler always returns a generic 500, so each route here
 * translates those thrown errors into real HTTP responses itself, the same
 * convention `routes/auth.ts` and `routes/account-identifiers.ts` use.
 */
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
      request.log.warn({ err: error }, "countrylinqa request rejected");
      return reply.code(status).send({ error: code });
    }
  };
}

export async function registerCountryLinqaRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  service: CountryLinqaService
) {
  const auth = createAuthenticator(config);
  const connectionLimit = simpleRateLimit({ windowMs: 60_000, max: 20, keyPrefix: "countrylinqa-connect" });

  const loadProfile = async (userId: string) => {
    const result = await db.query(`SELECT u.id, COALESCE(profile.display_name,'Linqa member') AS "displayName",
      COALESCE(profile.bio,'') AS bio,u.verified_country_code AS "verifiedCountryCode",u.country_verification_state AS "verificationState"
      FROM users u LEFT JOIN user_profiles profile ON profile.user_id=u.id WHERE u.id=$1 AND u.status='ACTIVE'`, [userId]);
    if (!result.rows[0]) throw Object.assign(new Error("Account unavailable"), { status: 404, code: "ACCOUNT_UNAVAILABLE" });
    return result.rows[0];
  };
  app.get("/v1/countrylinqa/profile", withErrors(async request => {
    const p = await auth(request); requireScope(p, "countrylinqa:read"); return loadProfile(p.userId);
  }));
  app.put("/v1/countrylinqa/profile", withErrors(async request => {
    const p = await auth(request); requireScope(p, "countrylinqa:write");
    const body = z.object({ displayName: z.string().trim().min(1).max(100), bio: z.string().trim().max(500) }).strict().parse(request.body);
    await loadProfile(p.userId);
    await db.query(`INSERT INTO user_profiles(user_id,display_name,bio) VALUES($1,$2,$3)
      ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,bio=EXCLUDED.bio,updated_at=now()`, [p.userId,body.displayName,body.bio]);
    return loadProfile(p.userId);
  }));
  app.get("/v1/countrylinqa/security/activity", withErrors(async request => {
    const p = await auth(request); requireScope(p, "countrylinqa:read");
    const result = await db.query(`SELECT id,event_type AS "eventType",severity,created_at AS "createdAt"
      FROM countrylinqa_security_events WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`, [p.userId]);
    return { items: result.rows };
  }));

  app.post("/v1/countrylinqa/discover/users/:id/connect", withErrors(async (request, reply) => {
    const p = await auth(request); requireScope(p, "countrylinqa:write"); connectionLimit(p.userId, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await db.query(`WITH ${viewerScopeCte(1)}
      INSERT INTO contact_requests(sender_user_id,recipient_user_id)
      SELECT $1,author.id FROM users author CROSS JOIN viewer_scope vs
      WHERE author.id=$2 AND author.id<>$1 AND ${authorScopePredicate("author")} AND ${safetyPredicate("author", 1)}
      ON CONFLICT(sender_user_id,recipient_user_id) DO UPDATE SET
        status=CASE WHEN contact_requests.status IN ('CANCELLED','DECLINED') OR (contact_requests.status='PENDING' AND contact_requests.expires_at<=now()) THEN 'PENDING' ELSE contact_requests.status END,
        expires_at=CASE WHEN contact_requests.status IN ('CANCELLED','DECLINED') OR contact_requests.expires_at<=now() THEN now()+interval '30 days' ELSE contact_requests.expires_at END,
        updated_at=now()
      WHERE contact_requests.status<>'BLOCKED'
      RETURNING id,status`, [p.userId,id]);
    if (result.rowCount !== 1) return reply.code(404).send({ error: "PERSON_UNAVAILABLE" });
    return result.rows[0];
  }));
  app.get("/v1/countrylinqa/connections", withErrors(async request => {
    const p = await auth(request); requireScope(p, "countrylinqa:read");
    const result = await db.query(`SELECT cr.id,cr.status,cr.sender_user_id AS "senderUserId",cr.recipient_user_id AS "recipientUserId",
        profile.display_name AS "displayName", (cr.recipient_user_id=$1) AS incoming
      FROM contact_requests cr JOIN users author ON author.id=CASE WHEN cr.sender_user_id=$1 THEN cr.recipient_user_id ELSE cr.sender_user_id END
      JOIN user_profiles profile ON profile.user_id=author.id
      WHERE (cr.sender_user_id=$1 OR cr.recipient_user_id=$1) AND (cr.status='ACCEPTED' OR (cr.status='PENDING' AND cr.expires_at>now()))
        AND ${safetyPredicate("author",1)} ORDER BY cr.created_at DESC LIMIT 100`, [p.userId]);
    return { items: result.rows };
  }));
  app.post("/v1/countrylinqa/connections/:id/resolve", withErrors(async (request, reply) => {
    const p = await auth(request); requireScope(p, "countrylinqa:write");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { action } = z.object({ action: z.enum(["ACCEPT", "DECLINE", "CANCEL"]) }).parse(request.body);
    const status = action === "ACCEPT" ? "ACCEPTED" : action === "DECLINE" ? "DECLINED" : "CANCELLED";
    const result = await db.query(`UPDATE contact_requests cr SET status=$3,updated_at=now()
      FROM users author WHERE cr.id=$2 AND cr.status='PENDING' AND cr.expires_at>now()
      AND author.id=CASE WHEN cr.sender_user_id=$1 THEN cr.recipient_user_id ELSE cr.sender_user_id END
      AND ${safetyPredicate("author",1)}
      AND (($4='CANCEL' AND cr.sender_user_id=$1) OR ($4<>'CANCEL' AND cr.recipient_user_id=$1)) RETURNING cr.id,cr.status`, [p.userId,id,status,action]);
    if (result.rowCount !== 1) return reply.code(404).send({ error: "CONNECTION_REQUEST_UNAVAILABLE" });
    return result.rows[0];
  }));

  app.get(
    "/v1/countrylinqa/catalog",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      return service.catalog();
    })
  );

  app.get(
    "/v1/countrylinqa/preferences",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      return service.preferences(p.userId);
    })
  );

  app.put(
    "/v1/countrylinqa/preferences",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const body = updatePreferencesSchema.parse(request.body);
      return service.savePreferences(p.userId, body);
    })
  );

  app.post(
    "/v1/countrylinqa/verification/confirm-country",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const body = confirmCountrySchema.parse(request.body);
      return service.confirmCountry(p.userId, body, request.ip);
    })
  );

  app.post(
    "/v1/countrylinqa/verification/request-clarification",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const body = clarifyCountrySchema.parse(request.body ?? {});
      return service.requestCountryClarification(p.userId, body.proposedCountryCode);
    })
  );

  app.get(
    "/v1/countrylinqa/discover/users",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      const query = discoverySearchSchema.parse(request.query);
      return discoverUsers(db, p.userId, query);
    })
  );

  app.get(
    "/v1/countrylinqa/feed/scope",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      return getFeedScope(db, p.userId);
    })
  );
}

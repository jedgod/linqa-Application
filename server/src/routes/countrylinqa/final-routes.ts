import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { Database } from "../../db/pool.js";
import { simpleRateLimit } from "../../services/countrylinqa/final/rate-limit.js";
import { searchFiltersSchema, collectionSearchSchema, pageItems } from "../../services/countrylinqa/search.js";
import { discoverCommunities } from "../../services/countrylinqa/golive/communityDiscovery.js";
import { viewerScopeCte, contentScopePredicate } from "../../services/countrylinqa/feed-scope.js";

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
      request.log.warn({ err: error }, "countrylinqa final request rejected");
      return reply.code(status).send({ error: code });
    }
  };
}

const targetSchema = z.object({
  businessId: z.string().uuid(),
  targets: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("COUNTRY"), countryCode: z.string().length(2).transform((x) => x.toUpperCase()) }),
        z.object({ type: z.literal("REGION"), regionCode: z.string().min(1).max(16).transform((x) => x.toUpperCase()) }),
        z.object({
          type: z.literal("STATE"),
          countryCode: z.string().length(2).transform((x) => x.toUpperCase()),
          stateRegion: z.string().min(1).max(100)
        })
      ])
    )
    .max(100)
});

const token = z.string().trim().min(1).max(60);
const saveSearchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // The advanced search adds these to the original filters; the alert job already understands all of them.
  filters: searchFiltersSchema.extend({
    city: z.string().trim().min(1).max(80).optional(),
    interests: z.array(token).max(20).optional(),
    languages: z.array(token).max(10).optional(),
    profession: token.optional()
  })
});

export async function registerCountryLinqaFinalRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const auth = createAuthenticator(config);
  const businessRateLimit = simpleRateLimit({ windowMs: 60_000, max: 60, keyPrefix: "countrylinqa-business" });

  const notificationSchema = z.object({
    countryTrends: z.boolean(), regionalTrends: z.boolean(), selectedCountryActivity: z.boolean(),
    countryEvents: z.boolean(), countryBusinesses: z.boolean(), securityAlerts: z.boolean(),
    digestFrequency: z.enum(["OFF", "DAILY", "WEEKLY"])
  }).strict();
  const notificationColumns = `country_trends AS "countryTrends", regional_trends AS "regionalTrends",
    selected_country_activity AS "selectedCountryActivity", country_events AS "countryEvents",
    country_businesses AS "countryBusinesses", security_alerts AS "securityAlerts", digest_frequency AS "digestFrequency"`;
  app.get("/v1/countrylinqa/notifications/preferences", withErrors(async request => {
    const p = await auth(request); requireScope(p, "countrylinqa:read");
    const result = await db.query(`SELECT ${notificationColumns} FROM countrylinqa_notification_preferences WHERE user_id=$1`, [p.userId]);
    return result.rows[0] ?? { countryTrends: true, regionalTrends: true, selectedCountryActivity: true,
      countryEvents: true, countryBusinesses: false, securityAlerts: true, digestFrequency: "DAILY" };
  }));
  app.put("/v1/countrylinqa/notifications/preferences", withErrors(async request => {
    const p = await auth(request); requireScope(p, "countrylinqa:write");
    const body = notificationSchema.parse(request.body);
    const result = await db.query(`INSERT INTO countrylinqa_notification_preferences
      (user_id,country_trends,regional_trends,selected_country_activity,country_events,country_businesses,security_alerts,digest_frequency)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id) DO UPDATE SET
      country_trends=EXCLUDED.country_trends,regional_trends=EXCLUDED.regional_trends,selected_country_activity=EXCLUDED.selected_country_activity,
      country_events=EXCLUDED.country_events,country_businesses=EXCLUDED.country_businesses,security_alerts=EXCLUDED.security_alerts,
      digest_frequency=EXCLUDED.digest_frequency,updated_at=now() RETURNING ${notificationColumns}`,
      [p.userId,body.countryTrends,body.regionalTrends,body.selectedCountryActivity,body.countryEvents,body.countryBusinesses,body.securityAlerts,body.digestFrequency]);
    return result.rows[0];
  }));
  app.get("/v1/countrylinqa/notifications", withErrors(async request => {
    const p = await auth(request); requireScope(p, "countrylinqa:read");
    const result = await db.query(`SELECT id,notification_type AS "notificationType",payload,created_at AS "createdAt"
      FROM countrylinqa_notification_outbox WHERE user_id=$1 AND status='SENT' ORDER BY created_at DESC,id DESC LIMIT 100`, [p.userId]);
    return { items: result.rows };
  }));

  // ---- business geo-targeting ----

  app.put(
    "/v1/countrylinqa/business/targets",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      businessRateLimit(p.userId, request);
      const body = targetSchema.parse(request.body);

      const owns = await db.query(`SELECT 1 FROM businesses WHERE id = $1 AND owner_user_id = $2`, [
        body.businessId,
        p.userId
      ]);
      if (owns.rowCount !== 1) {
        const error: any = new Error("Not the owner of this business.");
        error.status = 403;
        error.code = "FORBIDDEN";
        throw error;
      }

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM business_geo_targets WHERE business_id = $1`, [body.businessId]);
        for (const target of body.targets) {
          if (target.type === "COUNTRY") {
            await client.query(
              `INSERT INTO business_geo_targets (business_id, target_type, country_code) VALUES ($1,'COUNTRY',$2)`,
              [body.businessId, target.countryCode]
            );
          } else if (target.type === "REGION") {
            await client.query(
              `INSERT INTO business_geo_targets (business_id, target_type, region_code) VALUES ($1,'REGION',$2)`,
              [body.businessId, target.regionCode]
            );
          } else {
            await client.query(
              `INSERT INTO business_geo_targets (business_id, target_type, country_code, state_region) VALUES ($1,'STATE',$2,$3)`,
              [body.businessId, target.countryCode, target.stateRegion]
            );
          }
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return { ok: true };
    })
  );

  app.get(
    "/v1/countrylinqa/business/discover",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      businessRateLimit(p.userId, request);

      const result = await db.query(
        `WITH viewer AS (SELECT verified_country_code AS country_code FROM users WHERE id = $1)
         SELECT b.id, b.name, b.category, b.logo_url AS "logoUrl"
         FROM businesses b
         JOIN business_geo_targets t ON t.business_id = b.id AND t.enabled = TRUE
         CROSS JOIN viewer v
         LEFT JOIN countries c ON c.code = v.country_code
         WHERE b.status = 'ACTIVE'
           AND (
             (t.target_type = 'COUNTRY' AND t.country_code = v.country_code)
             OR (t.target_type = 'REGION' AND t.region_code = c.region_code)
             OR (t.target_type = 'STATE' AND t.country_code = v.country_code)
           )
         LIMIT 100`,
        [p.userId]
      );
      return { items: result.rows };
    })
  );

  // ---- country communities ----

  app.get("/v1/countrylinqa/communities/discover", withErrors(async request => {
    const p = await auth(request); requireScope(p, "countrylinqa:read");
    const query = collectionSearchSchema.parse(request.query);
    const result = await discoverCommunities(db, p.userId, query);
    return pageItems(result.rows, query);
  }));

  app.post(
    "/v1/countrylinqa/communities/country/:code/join",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const params = z.object({ code: z.string().length(2).transform((x) => x.toUpperCase()) }).parse(request.params);

      const allowed = await db.query(
        `SELECT 1 FROM countries c JOIN countrylinqa_country_status s ON s.country_code = c.code
         JOIN users u ON u.id=$2 AND u.status='ACTIVE' AND u.country_verification_state='VERIFIED'
         WHERE c.code = $1 AND c.enabled = TRUE AND s.community_enabled = TRUE`,
        [params.code, p.userId]
      );
      if (allowed.rowCount !== 1) {
        const error: any = new Error("Community not available for this country.");
        error.status = 422;
        error.code = "COUNTRY_COMMUNITY_UNAVAILABLE";
        throw error;
      }

      const joined = await db.query(
        `INSERT INTO country_community_memberships (user_id, country_code, membership_type, status)
         VALUES ($1,$2,'MANUAL','ACTIVE')
         ON CONFLICT (user_id, country_code) DO UPDATE SET status = 'ACTIVE', joined_at=now(), updated_at = now()
         WHERE country_community_memberships.status <> 'SUSPENDED' RETURNING country_code`,
        [p.userId, params.code]
      );
      if (joined.rowCount !== 1) throw Object.assign(new Error("Community membership is suspended"), { status: 403, code: "COMMUNITY_MEMBERSHIP_SUSPENDED" });
      return { joined: true, countryCode: params.code };
    })
  );

  app.post(
    "/v1/countrylinqa/communities/country/:code/leave",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const params = z.object({ code: z.string().length(2).transform((x) => x.toUpperCase()) }).parse(request.params);
      await db.query(
        `UPDATE country_community_memberships SET status = 'LEFT', updated_at = now() WHERE user_id = $1 AND country_code = $2 AND status='ACTIVE'`,
        [p.userId, params.code]
      );
      return { left: true, countryCode: params.code };
    })
  );

  app.get(
    "/v1/countrylinqa/communities/mine",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      const result = await db.query(
        `SELECT c.code, c.name, m.membership_type AS "membershipType", m.status, m.joined_at AS "joinedAt", TRUE AS joined,
           (SELECT count(*)::int FROM country_community_memberships members WHERE members.country_code=c.code AND members.status='ACTIVE') AS "memberCount"
         FROM country_community_memberships m
         JOIN countries c ON c.code = m.country_code
         WHERE m.user_id = $1 AND m.status = 'ACTIVE'
         ORDER BY c.name`,
        [p.userId]
      );
      return { items: result.rows };
    })
  );

  // ---- saved searches ----

  app.post(
    "/v1/countrylinqa/saved-searches",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const body = saveSearchSchema.parse(request.body);
      const result = await db.query(
        `INSERT INTO countrylinqa_saved_searches (user_id, name, filters)
         VALUES ($1,$2,$3)
         RETURNING id, name, filters, created_at AS "createdAt"`,
        [p.userId, body.name, JSON.stringify(body.filters)]
      );
      return reply.code(201).send(result.rows[0]);
    })
  );

  app.get(
    "/v1/countrylinqa/saved-searches",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:read");
      const result = await db.query(
        `SELECT id, name, filters, alerts_enabled AS "alertsEnabled", created_at AS "createdAt", updated_at AS "updatedAt", last_used_at AS "lastUsedAt"
         FROM countrylinqa_saved_searches WHERE user_id = $1 AND enabled = TRUE ORDER BY COALESCE(last_used_at, created_at) DESC, id`,
        [p.userId]
      );
      return { items: result.rows };
    })
  );

  // Opening a saved search records that it was used, so the list can say "Last used yesterday".
  app.post(
    "/v1/countrylinqa/saved-searches/:id/used",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const result = await db.query(
        `UPDATE countrylinqa_saved_searches SET last_used_at = now() WHERE id = $1 AND user_id = $2 AND enabled = TRUE RETURNING last_used_at AS "lastUsedAt"`,
        [params.id, p.userId]
      );
      if (result.rowCount !== 1) return reply.code(404).send({ error: "SAVED_SEARCH_NOT_FOUND" });
      return result.rows[0];
    })
  );

  app.delete(
    "/v1/countrylinqa/saved-searches/:id",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:write");
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      await db.query(
        `UPDATE countrylinqa_saved_searches SET enabled = FALSE, updated_at = now() WHERE id = $1 AND user_id = $2`,
        [params.id, p.userId]
      );
      return { deleted: true };
    })
  );
}

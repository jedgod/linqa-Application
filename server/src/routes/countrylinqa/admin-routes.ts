import { publicCountryError } from "./public-error.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { Database } from "../../db/pool.js";
import { auditCountryLinqa } from "../../services/countrylinqa/final/audit.js";
import { applyPolicyAction } from "../../services/countrylinqa/security/policy.js";
import { securityLog } from "../../services/countrylinqa/security/security-log.js";

function withErrors<T>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: "validation_error", details: error.flatten() });
      }
      const { status, code } = publicCountryError(error);
      request.log.warn({ err: error }, "countrylinqa admin request rejected");
      return reply.code(status).send({ error: code });
    }
  };
}

const statusSchema = z.object({
  discoveryEnabled: z.boolean().optional(),
  postingEnabled: z.boolean().optional(),
  businessEnabled: z.boolean().optional(),
  eventsEnabled: z.boolean().optional(),
  communityEnabled: z.boolean().optional(),
  reason: z.string().max(500).optional()
});

export async function registerCountryLinqaAdminRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const auth = createAuthenticator(config);

  app.get(
    "/v1/admin/countrylinqa/overview",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:admin");

      const [countries, verification, discoveryModes, openRiskEvents] = await Promise.all([
        db.query(
          `SELECT c.code, c.name, count(u.id)::int AS users
           FROM countries c LEFT JOIN users u ON u.verified_country_code = c.code
           WHERE c.enabled = TRUE GROUP BY c.code, c.name ORDER BY users DESC`
        ),
        db.query(
          `SELECT country_verification_state AS state, count(*)::int AS users FROM users GROUP BY country_verification_state`
        ),
        db.query(
          `SELECT COALESCE(p.mode, 'MY_COUNTRY') AS mode, count(*)::int AS users
           FROM users u LEFT JOIN country_discovery_preferences p ON p.user_id = u.id GROUP BY COALESCE(p.mode, 'MY_COUNTRY')`
        ),
        db.query(`SELECT severity, count(*)::int AS events FROM country_risk_events WHERE resolved_at IS NULL GROUP BY severity`)
      ]);

      return {
        countries: countries.rows,
        verification: verification.rows,
        discoveryModes: discoveryModes.rows,
        openRiskEvents: openRiskEvents.rows
      };
    })
  );

  app.get(
    "/v1/admin/countrylinqa/risk-events",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:admin");
      const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
      const result = await db.query(
        `SELECT id, user_id AS "userId", event_type AS "eventType", severity, details, created_at AS "createdAt"
         FROM country_risk_events WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT $1`,
        [query.limit]
      );
      return { items: result.rows };
    })
  );

  app.post(
    "/v1/admin/countrylinqa/risk-events/:id/resolve",
    withErrors(async (request, reply) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:admin");
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const result = await db.query(
        `UPDATE country_risk_events SET resolved_at = now(), resolved_by = $2 WHERE id = $1 AND resolved_at IS NULL RETURNING id`,
        [params.id, p.userId]
      );
      if (result.rowCount !== 1) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      return { resolved: true };
    })
  );

  app.get(
    "/v1/admin/countrylinqa/dashboard",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:admin");

      const [usersByCountry, discoveryModes, openRiskEvents, countryMemberships, businessTargets] = await Promise.all([
        db.query(
          `SELECT c.code, c.name, count(u.id)::int AS users FROM countries c
           LEFT JOIN users u ON u.verified_country_code = c.code GROUP BY c.code, c.name ORDER BY users DESC`
        ),
        db.query(
          `SELECT COALESCE(p.mode, 'MY_COUNTRY') AS mode, count(*)::int AS users
           FROM users u LEFT JOIN country_discovery_preferences p ON p.user_id = u.id GROUP BY COALESCE(p.mode, 'MY_COUNTRY')`
        ),
        db.query(`SELECT severity, count(*)::int AS events FROM country_risk_events WHERE resolved_at IS NULL GROUP BY severity`),
        db.query(
          `SELECT country_code AS "countryCode", count(*)::int AS memberships
           FROM country_community_memberships WHERE status = 'ACTIVE' GROUP BY country_code`
        ),
        db.query(
          `SELECT target_type AS "targetType", count(*)::int AS businesses
           FROM business_geo_targets WHERE enabled = TRUE GROUP BY target_type`
        )
      ]);

      return {
        usersByCountry: usersByCountry.rows,
        discoveryModes: discoveryModes.rows,
        openRiskEvents: openRiskEvents.rows,
        countryMemberships: countryMemberships.rows,
        businessTargets: businessTargets.rows
      };
    })
  );

  app.patch(
    "/v1/admin/countrylinqa/countries/:code/status",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:admin");
      const params = z.object({ code: z.string().length(2).transform((x) => x.toUpperCase()) }).parse(request.params);
      const body = statusSchema.parse(request.body);

      const before = await db.query(`SELECT * FROM countrylinqa_country_status WHERE country_code = $1`, [params.code]);
      if (before.rowCount !== 1) {
        const error: any = new Error("Country status row not found.");
        error.status = 404;
        error.code = "COUNTRY_NOT_FOUND";
        throw error;
      }

      const result = await db.query(
        `UPDATE countrylinqa_country_status SET
           discovery_enabled = COALESCE($2, discovery_enabled),
           posting_enabled = COALESCE($3, posting_enabled),
           business_enabled = COALESCE($4, business_enabled),
           events_enabled = COALESCE($5, events_enabled),
           community_enabled = COALESCE($6, community_enabled),
           reason = COALESCE($7, reason),
           updated_by = $8,
           updated_at = now()
         WHERE country_code = $1
         RETURNING *`,
        [
          params.code,
          body.discoveryEnabled ?? null,
          body.postingEnabled ?? null,
          body.businessEnabled ?? null,
          body.eventsEnabled ?? null,
          body.communityEnabled ?? null,
          body.reason ?? null,
          p.userId
        ]
      );

      await auditCountryLinqa(db, {
        userId: p.userId,
        actorUserId: p.userId,
        eventType: "ADMIN_COUNTRY_STATUS_CHANGED",
        oldValue: before.rows[0],
        newValue: result.rows[0],
        metadata: { countryCode: params.code }
      });

      return result.rows[0];
    })
  );

  app.get(
    "/v1/admin/countrylinqa/security/events",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:admin");
      const query = z.object({ severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional() }).parse(request.query);
      const result = await db.query(
        `SELECT id, user_id AS "userId", event_type AS "eventType", severity, metadata, created_at AS "createdAt"
         FROM countrylinqa_security_events
         WHERE ($1::text IS NULL OR severity = $1)
         ORDER BY created_at DESC LIMIT 200`,
        [query.severity ?? null]
      );
      return { items: result.rows };
    })
  );

  app.post(
    "/v1/admin/countrylinqa/security/users/:userId/block-country-changes",
    withErrors(async (request) => {
      const p = await auth(request);
      requireScope(p, "countrylinqa:admin");
      const params = z.object({ userId: z.string().uuid() }).parse(request.params);
      const body = z.object({ reason: z.string().max(500).optional() }).parse(request.body ?? {});

      await applyPolicyAction(db, {
        userId: params.userId,
        actionType: "COUNTRY_CHANGES_BLOCKED",
        details: { reason: body.reason ?? "ADMIN_SECURITY_ACTION" },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
      await securityLog(db, {
        userId: params.userId,
        actorUserId: p.userId,
        eventType: "ADMIN_BLOCKED_COUNTRY_CHANGES",
        severity: "HIGH"
      });

      return { blocked: true };
    })
  );
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { Database } from "../../db/pool.js";
import type { MetricsSink } from "../../observability/metrics-registry.js";
import { createDiscoveryCache } from "../../services/countrylinqa/engine/redis-cache.js";
import { simpleRateLimit } from "../../services/countrylinqa/final/rate-limit.js";
import { DiscoveryControls } from "../../services/countrylinqa/engine/controls.js";
import { cursorKey } from "../../services/countrylinqa/engine/cursor.js";
import { discoveryFeaturesSchema, getDiscoveryFeatures, saveDiscoveryFeatures } from "../../services/countrylinqa/engine/features.js";
import { AdvancedDiscoveryService } from "../../services/countrylinqa/engine/people.js";
import { SEARCH_TYPES, unifiedSearch } from "../../services/countrylinqa/engine/unified-search.js";
import { savedFiltersToDiscovery } from "../../services/countrylinqa/engine/jobs.js";
import { MAX_DETAIL_IDS, blockedAccounts, countryHub, personDetails, setEventInterest, subscriptionSummary, unblockAccount, worldCountries, worldHome } from "../../services/countrylinqa/world.js";

function withErrors<T>(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>, metrics?: MetricsSink) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(422).send({ error: "validation_error", details: error.flatten() });
      }
      const status = typeof error?.status === "number" ? error.status : 400;
      const code = typeof error?.code === "string" ? error.code : "invalid_request";
      request.log.warn({ code, status }, "countrylinqa engine request rejected");
      // 4xx are caller mistakes, not service faults; only 5xx and rate-limit/unavailable count toward the error SLO.
      if (status >= 500 || status === 429) metrics?.increment("countrylinqa_discovery_errors_total", { status });
      return reply.code(status).send({ error: code });
    }
  };
}

const peopleSearchSchema = z.object({
  filters: z.unknown().default({}),
  limit: z.number().int().min(1).max(50).default(30),
  cursor: z.string().min(1).max(600).optional()
}).strict();

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  types: z.string().default(SEARCH_TYPES.join(",")).transform((value) => value.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(z.enum(SEARCH_TYPES)).min(1).max(SEARCH_TYPES.length)),
  limit: z.coerce.number().int().min(1).max(30).default(10)
}).strict();

/**
 * CountryLinqa discovery engine (v1-v4 packs, adapted). Every endpoint here
 * delegates to code that applies the server-resolved geographic policy before
 * ranking and pagination; nothing in a request body can widen that scope.
 */
export async function registerCountryLinqaEngineRoutes(
  app: FastifyInstance, config: AppConfig, db: Database, metrics?: MetricsSink
) {
  const auth = createAuthenticator(config);
  // Shared across API nodes when REDIS_URL is set; any Redis failure is a cache miss, never an authorization decision.
  const cache = createDiscoveryCache(config.REDIS_URL, (error) => app.log.warn({ err: error.message }, "countrylinqa cache unavailable"));
  const controls = new DiscoveryControls(db, cache);
  const people = new AdvancedDiscoveryService(db, cache, cursorKey(config), (event) => {
    metrics?.increment("countrylinqa_discovery_requests_total", { surface: event.surface, cache: event.cache });
    metrics?.observe("countrylinqa_discovery_latency_ms", event.latencyMs, { surface: event.surface });
  });

  const searchLimit = simpleRateLimit({ windowMs: 60_000, max: 30, keyPrefix: "clq-search" });
  const pageLimit = simpleRateLimit({ windowMs: 60_000, max: 60, keyPrefix: "clq-people" });
  const writeLimit = simpleRateLimit({ windowMs: 60 * 60_000, max: 30, keyPrefix: "clq-engine-write" });

  app.post("/v1/countrylinqa/discover/people/search", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:read"); pageLimit(p.userId, request);
    await controls.assertAvailable("PEOPLE", p.userId);
    const body = peopleSearchSchema.parse(request.body ?? {});
    return people.people(p.userId, body.filters, { limit: body.limit, cursor: body.cursor });
  }, metrics));

  app.get("/v1/countrylinqa/search", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:read"); searchLimit(p.userId, request);
    await controls.assertAvailable("PEOPLE", p.userId);
    const query = searchQuerySchema.parse(request.query);
    return unifiedSearch({ db, people }, p.userId, { q: query.q, types: query.types, limit: query.limit });
  }, metrics));

  app.get("/v1/countrylinqa/recommendations/people", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:read"); pageLimit(p.userId, request);
    await controls.assertAvailable("RECOMMENDATIONS", p.userId);
    const snapshot = await db.query(
      `SELECT s.candidate_user_id AS id, s.score, s.reason_codes AS reasons
       FROM countrylinqa_recommendation_snapshots s
       JOIN country_discovery_preferences pref ON pref.user_id = s.user_id AND pref.version = s.policy_version
       WHERE s.user_id = $1 AND s.expires_at > now()
       ORDER BY s.score DESC, s.candidate_user_id LIMIT 50`, [p.userId]
    );
    if (snapshot.rowCount) {
      // Snapshots are re-checked against live policy and blocks on every read.
      const items = await people.hydrate(p.userId, snapshot.rows.map((r: any) => ({ id: r.id, score: Number(r.score), reasons: r.reasons })));
      return { items, source: "SNAPSHOT" };
    }
    const live = await people.people(p.userId, {}, { limit: 20 });
    return { items: live.items, source: "LIVE" };
  }, metrics));

  app.get("/v1/countrylinqa/discovery/features", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:read");
    return getDiscoveryFeatures(db, p.userId);
  }, metrics));

  app.put("/v1/countrylinqa/discovery/features", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:write"); writeLimit(p.userId, request);
    return saveDiscoveryFeatures(db, p.userId, discoveryFeaturesSchema.parse(request.body ?? {}));
  }, metrics));

  // Opt a saved search in or out of alerts. Creation/listing stay on the existing saved-search routes.
  app.patch("/v1/countrylinqa/saved-searches/:id/alerts", withErrors(async (request, reply) => {
    const p = await auth(request); requireScope(p, "countrylinqa:write"); writeLimit(p.userId, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { alertsEnabled } = z.object({ alertsEnabled: z.boolean() }).strict().parse(request.body);
    const found = await db.query(`SELECT filters FROM countrylinqa_saved_searches WHERE id = $1 AND user_id = $2 AND enabled`, [id, p.userId]);
    if (!found.rowCount) return reply.code(404).send({ error: "SAVED_SEARCH_NOT_FOUND" });
    if (alertsEnabled) {
      await controls.assertAvailable("SAVED_SEARCH_ALERTS", p.userId);
      savedFiltersToDiscovery(found.rows[0].filters); // reject filters alerts could never run
      const count = await db.query(`SELECT count(*)::int AS n FROM countrylinqa_saved_searches WHERE user_id = $1 AND enabled AND alerts_enabled AND id <> $2`, [p.userId, id]);
      if (count.rows[0].n >= 10) return reply.code(409).send({ error: "ALERT_LIMIT_REACHED" });
    }
    await db.query(
      `UPDATE countrylinqa_saved_searches SET alerts_enabled = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2`, [id, p.userId, alertsEnabled]
    );
    return { id, alertsEnabled };
  }, metrics));

  // ---- Linqa World pages: read models over the same scope and safety rules ----------------
  app.get("/v1/countrylinqa/world/home", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:read"); pageLimit(p.userId, request);
    return worldHome(db, p.userId);
  }, metrics));

  app.get("/v1/countrylinqa/world/countries", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:read"); pageLimit(p.userId, request);
    return worldCountries(db, p.userId);
  }, metrics));

  // Card and profile details for people the viewer is allowed to see. Anyone outside scope is simply absent.
  app.get("/v1/countrylinqa/people/details", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:read"); pageLimit(p.userId, request);
    const query = z.object({ ids: z.string().min(36).max(MAX_DETAIL_IDS * 37).transform((v) => v.split(",")).pipe(z.array(z.string().uuid()).min(1).max(MAX_DETAIL_IDS)) }).strict().parse(request.query);
    return { items: await personDetails(db, p.userId, query.ids) };
  }, metrics));

  app.get("/v1/countrylinqa/world/countries/:code", withErrors(async (request, reply) => {
    const p = await auth(request); requireScope(p, "countrylinqa:read"); pageLimit(p.userId, request);
    const { code } = z.object({ code: z.string().length(2).regex(/^[A-Za-z]{2}$/) }).strict().parse(request.params);
    const hub = await countryHub(db, p.userId, code);
    if (!hub) return reply.code(404).send({ error: "COUNTRY_NOT_FOUND" });
    return hub;
  }, metrics));

  app.post("/v1/countrylinqa/events/:id/interest", withErrors(async (request, reply) => {
    const p = await auth(request); requireScope(p, "countrylinqa:write"); writeLimit(p.userId, request);
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    const body = z.object({ interested: z.boolean() }).strict().parse(request.body);
    const result = await setEventInterest(db, p.userId, id, body.interested);
    if (!result) return reply.code(404).send({ error: "EVENT_UNAVAILABLE" });
    return result;
  }, metrics));

  app.get("/v1/countrylinqa/subscription", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:read"); pageLimit(p.userId, request);
    return subscriptionSummary(db, p.userId);
  }, metrics));

  app.get("/v1/countrylinqa/blocked", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:read"); pageLimit(p.userId, request);
    return { items: await blockedAccounts(db, p.userId) };
  }, metrics));

  app.delete("/v1/countrylinqa/blocked/:userId", withErrors(async (request) => {
    const p = await auth(request); requireScope(p, "countrylinqa:write"); writeLimit(p.userId, request);
    const { userId } = z.object({ userId: z.string().uuid() }).strict().parse(request.params);
    return unblockAccount(db, p.userId, userId);
  }, metrics));
}

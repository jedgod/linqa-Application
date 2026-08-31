import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { HIDEABLE_HOME_SECTIONS } from "./home.types.js";
import { HOME_NEWS_CATEGORIES } from "./news-normalization.js";
import { resolveJurisdictionCountry } from "./home-dependencies.js";
import type { HomeModule } from "./home.module.js";

// The packs are written against Express (`Router()`, `req.session.userId`).
// This server is Fastify with bearer-JWT principals, so the same contract is
// expressed with `createAuthenticator` + `requireScope` — the one, existing
// auth mechanism — rather than introducing a second session concept.
// Shape is validated here; *membership* is filtered by
// `sanitizeHomePreferences`. The split is deliberate: rejecting an unknown
// section name outright would mean a client one version out of step with the
// server's taxonomy cannot save any preference at all, so unknown entries are
// dropped and echoed back as absent instead of failing the whole request.
// Bounds are still enforced so the request cannot be unbounded.
const boundedStrings = (max: number) => z.array(z.string().max(64)).max(max).optional();

const PreferencesBody = z.object({
  hiddenSections: boundedStrings(HIDEABLE_HOME_SECTIONS.length * 2),
  preferredCategories: boundedStrings(HOME_NEWS_CATEGORIES.length * 2),
  followedCountries: boundedStrings(24),
  followedTopics: boundedStrings(24),
  quickActions: z.array(z.unknown()).max(12).optional(),
  personalizationEnabled: z.boolean().optional()
});

const NewsQueryParams = z.object({
  category: z.enum(HOME_NEWS_CATEGORIES).optional(),
  country: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  breakingOnly: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(500).default(0)
});

export async function registerHomeRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  home: HomeModule
) {
  const authenticate = createAuthenticator(config);

  const withPrincipal = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "profile:read");
      return principal;
    } catch (error) {
      request.log.warn({ err: error }, "home request authentication rejected");
      await reply.code(401).send({ error: "unauthenticated" });
      return null;
    }
  };

  app.get("/v1/mobile/home", async (request, reply) => {
    const principal = await withPrincipal(request, reply);
    if (!principal) return reply;

    const country = await resolveJurisdictionCountry(db, principal.userId);
    if (!country) {
      // Jurisdiction is server-authoritative and Home is jurisdiction-scoped,
      // so there is nothing honest to render until CountryLinqa verification
      // has completed. 409 tells the client to route into that flow.
      return reply.code(409).send({ code: "HOME_JURISDICTION_REQUIRED" });
    }

    try {
      const feed = await home.feed.build(principal.userId, country);
      // Home carries the user's unread counts and conversation previews:
      // never cacheable, never shared.
      void reply.header("Cache-Control", "private, no-store");
      return reply.code(200).send(feed);
    } catch (error) {
      request.log.error({ err: error, userId: principal.userId }, "home feed build failed");
      return reply.code(503).send({ code: "HOME_FEED_UNAVAILABLE" });
    }
  });

  app.get("/v1/mobile/home/preferences", async (request, reply) => {
    const principal = await withPrincipal(request, reply);
    if (!principal) return reply;
    const preferences = await home.personalization.getPreferences(principal.userId);
    void reply.header("Cache-Control", "private, no-store");
    return reply.code(200).send({
      preferences,
      hideableSections: HIDEABLE_HOME_SECTIONS,
      categories: HOME_NEWS_CATEGORIES
    });
  });

  app.put("/v1/mobile/home/preferences", async (request, reply) => {
    const principal = await withPrincipal(request, reply);
    if (!principal) return reply;

    const parsed = PreferencesBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ code: "INVALID_HOME_PREFERENCES", details: parsed.error.flatten() });
    }

    // A PUT replaces the document, so merge over the stored value first:
    // a client that only wants to toggle one section should not have to
    // resend everything it doesn't know about.
    const current = await home.personalization.getPreferences(principal.userId);
    const preferences = await home.personalization.savePreferences(principal.userId, {
      ...current,
      ...parsed.data
    });
    void reply.header("Cache-Control", "private, no-store");
    return reply.code(200).send({ preferences });
  });

  /**
   * World News list, served from the durable store rather than from an
   * upstream call. This is what makes the news screen usable while every
   * provider is down: articles already validated and persisted stay readable.
   */
  app.get("/v1/mobile/home/news", async (request, reply) => {
    const principal = await withPrincipal(request, reply);
    if (!principal) return reply;

    const parsed = NewsQueryParams.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ code: "INVALID_NEWS_QUERY", details: parsed.error.flatten() });
    }
    const query = parsed.data;

    const [articles, total] = await Promise.all([
      home.repository.listArticles({
        category: query.category,
        countryCode: query.country?.toUpperCase(),
        breakingOnly: query.breakingOnly === "true",
        limit: query.limit,
        offset: query.offset
      }),
      home.repository.countArticles({
        category: query.category,
        countryCode: query.country?.toUpperCase()
      })
    ]);

    void reply.header("Cache-Control", "private, no-store");
    return reply.code(200).send({
      articles: articles.map((article) => ({
        ...article,
        publishedAt: new Date(article.publishedAt).toISOString()
      })),
      total,
      limit: query.limit,
      offset: query.offset,
      // Attribution is a licensing obligation, not a UI preference — state it
      // in the payload so a client cannot render these without it by accident.
      attributionRequired: true
    });
  });

  // Unauthenticated on purpose: this is a dependency-readiness probe for
  // orchestration, and it returns no user data.
  app.get("/health/home", async (_request, reply) => {
    const readiness = await home.health.readiness();
    return reply.code(readiness.ready ? 200 : 503).send(readiness);
  });
}

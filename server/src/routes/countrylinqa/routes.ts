import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import { createAuthenticator, requireScope } from "../../auth/jwt.js";
import type { CountryLinqaService } from "../../services/countrylinqa/service.js";
import { discoverUsers } from "../../services/countrylinqa/discovery.js";
import { getFeedScope } from "../../services/countrylinqa/feed-scope.js";
import type { Database } from "../../db/pool.js";

const countryCode = z.string().trim().length(2).transform((x) => x.toUpperCase());
const regionCode = z.string().trim().min(1).max(16).transform((x) => x.toUpperCase());

const updatePreferencesSchema = z.object({
  mode: z.enum(["MY_COUNTRY", "SELECTED_COUNTRIES", "REGION", "GLOBAL"]),
  selectedCountries: z.array(countryCode).max(250).default([]),
  selectedRegions: z.array(regionCode).max(50).default([]),
  locationPrecision: z.enum(["COUNTRY", "STATE", "CITY"]).default("COUNTRY"),
  showCity: z.boolean().default(false)
});

const confirmCountrySchema = z.object({
  claimedCountryCode: countryCode,
  simCountryCode: countryCode.optional(),
  localeCountryCode: countryCode.optional()
});

const discoverySearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  country: countryCode.optional(),
  region: regionCode.optional(),
  verifiedOnly: z.coerce.boolean().default(true),
  onlineOnly: z.coerce.boolean().default(false),
  language: z.string().trim().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().uuid().optional()
});

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

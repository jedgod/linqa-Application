import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import type { HomeModule } from "./home.module.js";
import { PublisherTrustAdminService } from "./publisher-trust.admin.service.js";

const PublisherParams = z.object({
  domain: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "INVALID_PUBLISHER_DOMAIN")
});

const PublisherBody = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  countryCode: z.string().regex(/^[A-Za-z]{2}$/).nullish(),
  trustStatus: z.enum(["TRUSTED", "LIMITED", "BLOCKED", "UNKNOWN"]),
  minProviderScore: z.coerce.number().min(0).max(1).default(0.75),
  allowBreaking: z.boolean().default(false),
  allowExternalLinks: z.boolean().default(true),
  attributionRequired: z.boolean().default(true),
  notes: z.string().trim().max(2000).nullish(),
  // Required so the audit row always explains *why* a publisher's trust
  // changed — a trust decision with no recorded rationale is not auditable.
  reasonCode: z.string().trim().min(3).max(100)
});

const ProviderStateBody = z.object({
  state: z.enum(["HEALTHY", "DEGRADED", "OPEN_CIRCUIT", "DISABLED"])
});

export async function registerHomeAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  home: HomeModule
) {
  const authenticate = createAuthenticator(config);
  const admin = new PublisherTrustAdminService(db);

  const withStaff = async (request: FastifyRequest, reply: FastifyReply, scope: string) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, scope);
      return principal;
    } catch (error) {
      request.log.warn({ err: error, scope }, "home admin request rejected");
      await reply.code(403).send({ error: "forbidden" });
      return null;
    }
  };

  app.get("/v1/admin/home/publishers", async (request, reply) => {
    const principal = await withStaff(request, reply, "ops:home:publisher:read");
    if (!principal) return reply;
    const publishers = await home.publisherRepository.list();
    return reply.code(200).send({ publishers });
  });

  app.get("/v1/admin/home/providers", async (request, reply) => {
    const principal = await withStaff(request, reply, "ops:home:publisher:read");
    if (!principal) return reply;
    const [providers, readiness] = await Promise.all([
      home.providerHealth.list(),
      home.health.readiness()
    ]);
    return reply.code(200).send({ providers, readiness });
  });

  app.put("/v1/admin/home/publishers/:domain", async (request, reply) => {
    const principal = await withStaff(request, reply, "ops:home:publisher:write");
    if (!principal) return reply;

    const params = PublisherParams.safeParse(request.params ?? {});
    if (!params.success) return reply.code(400).send({ code: "INVALID_PUBLISHER_DOMAIN" });

    const body = PublisherBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(422).send({ code: "INVALID_PUBLISHER_TRUST", details: body.error.flatten() });
    }

    const domain = params.data.domain;
    const input = body.data;

    try {
      const publisher = await admin.upsert(
        {
          domain,
          displayName: input.displayName ?? domain,
          countryCode: input.countryCode ? input.countryCode.toUpperCase() : null,
          trustStatus: input.trustStatus,
          minProviderScore: input.minProviderScore,
          allowBreaking: input.allowBreaking,
          allowExternalLinks: input.allowExternalLinks,
          attributionRequired: input.attributionRequired,
          notes: input.notes ?? null
        },
        {
          actorUserId: principal.userId,
          actorScopes: [...principal.scopes],
          requestId: String(request.id),
          reasonCode: input.reasonCode
        }
      );

      // Blocking (or de-linking) has to take effect immediately, not at the
      // next cache expiry — otherwise the block is advisory for up to 30
      // minutes of stale window.
      const purged = input.trustStatus === "BLOCKED" || !input.allowExternalLinks
        ? await admin.purgePublisherContent(domain)
        : null;

      return reply.code(200).send({ publisher, purged });
    } catch (error) {
      request.log.error({ err: error, domain }, "home publisher trust write failed");
      return reply.code(500).send({ code: "PUBLISHER_TRUST_WRITE_FAILED" });
    }
  });

  app.put("/v1/admin/home/providers/:provider/state", async (request, reply) => {
    const principal = await withStaff(request, reply, "ops:home:publisher:write");
    if (!principal) return reply;

    const provider = String((request.params as { provider?: string }).provider ?? "").trim();
    const known = home.providers.map((candidate) => candidate.name);
    if (!known.includes(provider)) {
      return reply.code(404).send({ code: "UNKNOWN_NEWS_PROVIDER", known });
    }

    const body = ProviderStateBody.safeParse(request.body ?? {});
    if (!body.success) return reply.code(422).send({ code: "INVALID_PROVIDER_STATE" });

    await home.providerHealth.setState(provider, body.data.state);
    return reply.code(200).send({ provider, state: body.data.state });
  });
}

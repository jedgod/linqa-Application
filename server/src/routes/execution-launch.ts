import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import {
  createAuthenticator,
  requireScope
} from "../auth/jwt.js";

import type { ReleasePromotionService } from "../services/release-promotion.service.js";
import type { CommunityService } from "../services/community.service.js";
import type { BusinessProfileService } from "../services/business-profile.service.js";
import type { ScimService } from "../services/scim.service.js";
import type { LegalHoldService } from "../services/legal-hold.service.js";
import type { OrganizationAuthorizationService } from "../services/organization-authorization.service.js";

export async function registerExecutionLaunchRoutes(
  app: FastifyInstance,
  config: AppConfig,
  services: {
    promotions: ReleasePromotionService;
    communities: CommunityService;
    businesses: BusinessProfileService;
    scim: ScimService;
    legalHolds: LegalHoldService;
    orgAuthorization: OrganizationAuthorizationService;
  }
) {
  const authenticate = createAuthenticator(config);

  app.post("/v1/admin/promotions", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "release:promote");

      const body = z.object({
        milestoneCode: z.enum(["1.0", "2.0", "3.0"]),
        featureKey: z.string().min(2).max(100),
        releaseChannel: z.enum([
          "INTERNAL",
          "ALPHA",
          "BETA",
          "CANARY",
          "GENERAL_AVAILABILITY"
        ]),
        rolloutPercentage: z.number().int().min(0).max(100),
        evidence: z.record(z.string(), z.unknown()).optional()
      }).parse(request.body);

      const promotion = await services.promotions.request({
        milestoneCode: body.milestoneCode,
        featureKey: body.featureKey,
        releaseChannel: body.releaseChannel,
        rolloutPercentage: body.rolloutPercentage,
        requestedBy: principal.subject,
        ...(body.evidence !== undefined ? { evidence: body.evidence } : {})
      });

      return reply.code(201).send(promotion);
    } catch (error) {
      request.log.warn({ err: error }, "promotion request rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post(
    "/v1/admin/promotions/:promotionId/approve",
    async (request, reply) => {
      try {
        const principal = await authenticate(request);
        requireScope(principal, "release:approve");

        const params = z.object({
          promotionId: z.string().uuid()
        }).parse(request.params);

        return await services.promotions.approve({
          promotionId: params.promotionId,
          approvedBy: principal.subject
        });
      } catch (error) {
        request.log.warn({ err: error }, "promotion approval rejected");
        return reply.code(400).send({ error: "invalid_request" });
      }
    }
  );

  app.post(
    "/v1/admin/promotions/:promotionId/rollback",
    async (request, reply) => {
      try {
        const principal = await authenticate(request);
        requireScope(principal, "release:rollback");

        const params = z.object({
          promotionId: z.string().uuid()
        }).parse(request.params);

        const body = z.object({
          reason: z.string().min(10).max(1000)
        }).parse(request.body);

        await services.promotions.rollback({
          promotionId: params.promotionId,
          actor: principal.subject,
          reason: body.reason
        });

        return reply.code(204).send();
      } catch (error) {
        request.log.warn({ err: error }, "promotion rollback rejected");
        return reply.code(400).send({ error: "invalid_request" });
      }
    }
  );

  app.post("/v1/communities", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "communities:write");

      const body = z.object({
        name: z.string().min(2).max(100),
        visibility: z.enum(["PRIVATE", "INVITE_ONLY", "PUBLIC"])
      }).parse(request.body);

      const community = await services.communities.create({
        ownerUserId: principal.userId,
        name: body.name,
        visibility: body.visibility
      });

      return reply.code(201).send(community);
    } catch (error) {
      request.log.warn({ err: error }, "community creation rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.put("/v1/business/profile", async (request, reply) => {
    try {
      const principal = await authenticate(request);
      requireScope(principal, "business:write");

      const body = z.object({
        organizationId: z.string().uuid().optional(),
        displayName: z.string().min(2).max(120),
        category: z.string().min(2).max(100),
        description: z.string().max(2000).optional(),
        website: z.string().url().optional(),
        supportHours: z.record(z.string(), z.unknown()).optional()
      }).parse(request.body);

      return await services.businesses.upsert({
        userId: principal.userId,
        displayName: body.displayName,
        category: body.category,
        ...(body.organizationId !== undefined ? { organizationId: body.organizationId } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.website !== undefined ? { website: body.website } : {}),
        ...(body.supportHours !== undefined ? { supportHours: body.supportHours } : {})
      });
    } catch (error) {
      request.log.warn({ err: error }, "business profile update rejected");
      return reply.code(400).send({ error: "invalid_request" });
    }
  });

  app.post(
    "/v1/scim/v2/organizations/:organizationId/Users",
    async (request, reply) => {
      try {
        const principal = await authenticate(request);
        requireScope(principal, "scim:write");

        const params = z.object({
          organizationId: z.string().uuid()
        }).parse(request.params);

        try {
          await services.orgAuthorization.requireScope({
            organizationId: params.organizationId,
            subject: principal.subject,
            requiredScope: "scim:write"
          });
        } catch (authorizationError) {
          request.log.warn(
            { err: authorizationError, organizationId: params.organizationId },
            "SCIM user upsert denied by organization authorization"
          );
          return reply.code(403).send({ error: "organization_forbidden" });
        }

        const body = z.object({
          externalId: z.string().optional(),
          userName: z.string().min(3).max(320),
          displayName: z.string().max(200).optional(),
          active: z.boolean().default(true),
          rawAttributes: z.record(z.string(), z.unknown()).optional()
        }).parse(request.body);

        const user = await services.scim.upsertUser({
          organizationId: params.organizationId,
          userName: body.userName,
          active: body.active,
          ...(body.externalId !== undefined ? { externalId: body.externalId } : {}),
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.rawAttributes !== undefined ? { rawAttributes: body.rawAttributes } : {})
        });

        return reply.code(201).send({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          ...user
        });
      } catch (error) {
        request.log.warn({ err: error }, "SCIM user upsert rejected");
        return reply.code(400).send({ error: "invalid_request" });
      }
    }
  );

  app.post(
    "/v1/organizations/:organizationId/legal-holds",
    async (request, reply) => {
      try {
        const principal = await authenticate(request);
        requireScope(principal, "legal-hold:write");

        const params = z.object({
          organizationId: z.string().uuid()
        }).parse(request.params);

        try {
          await services.orgAuthorization.requireScope({
            organizationId: params.organizationId,
            subject: principal.subject,
            requiredScope: "legal-hold:write"
          });
        } catch (authorizationError) {
          request.log.warn(
            { err: authorizationError, organizationId: params.organizationId },
            "legal hold creation denied by organization authorization"
          );
          return reply.code(403).send({ error: "organization_forbidden" });
        }

        const body = z.object({
          name: z.string().min(3).max(200),
          scope: z.record(z.string(), z.unknown())
        }).parse(request.body);

        const hold = await services.legalHolds.create({
          organizationId: params.organizationId,
          name: body.name,
          scope: body.scope,
          createdByUserId: principal.userId
        });

        return reply.code(201).send(hold);
      } catch (error) {
        request.log.warn({ err: error }, "legal hold creation rejected");
        return reply.code(400).send({ error: "invalid_request" });
      }
    }
  );
}

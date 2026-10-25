import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { assertActivePrincipal } from "../auth/active-principal.js";
import { createAuthenticator, requireScope, ScopeAuthorizationError } from "../auth/jwt.js";
import { CommunityError, type CommunityService } from "../services/community.service.js";

/**
 * Communities REST API (/api/communities). Authorization is enforced here and in CommunityService, never by what the mobile
 * UI chooses to show: every route needs a live session, `communities:read` (GET) or `communities:write` (everything else),
 * and the service checks the caller's membership and role against the database on each call.
 *
 * Non-members of a private community get the same 404 as for a community that does not exist.
 */
const id = z.string().uuid();
const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
});

const createBody = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().max(3000).default(""),
  category: z.string().trim().min(2).max(60).default("general"),
  visibility: z.enum(["PUBLIC", "PRIVATE", "INVITE_ONLY"]).default("PUBLIC"),
  countryCode: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  rules: z.string().trim().max(5000).default("")
}).strict();

const statusFor: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  membership_denied: 403,
  invite_required: 403,
  owner_cannot_leave: 409,
  request_not_pending: 409,
  limit_reached: 409
};

declare module "fastify" {
  interface FastifyRequest {
    communityUserId?: string;
  }
}

export async function registerCommunityRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: Database,
  communities: CommunityService
) {
  const authenticate = createAuthenticator(config);
  const strictWrite = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };
  const redeemLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  await app.register(async (api) => {
    api.addHook("preHandler", async (request, reply) => {
      try {
        const principal = await authenticate(request);
        requireScope(principal, request.method === "GET" ? "communities:read" : "communities:write");
        await assertActivePrincipal(db, principal);
        request.communityUserId = principal.userId;
      } catch (error) {
        return reply.code(error instanceof ScopeAuthorizationError ? 403 : 401).send({ error: error instanceof ScopeAuthorizationError ? "forbidden" : "unauthorized" });
      }
    });

    const me = (request: FastifyRequest) => request.communityUserId as string;

    /** Maps service errors to HTTP; validation failures are 400 and anything unexpected is a logged 500. */
    const guard = <T>(work: (request: FastifyRequest, reply: FastifyReply) => Promise<T>) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          return await work(request, reply);
        } catch (error) {
          if (error instanceof z.ZodError) return reply.code(400).send({ error: "invalid_request" });
          if (error instanceof CommunityError) return reply.code(statusFor[error.code] ?? 400).send({ error: error.code });
          throw error;
        }
      };

    api.get("/", guard(async (request) => {
      const q = z.object({
        q: z.string().trim().max(100).optional(),
        category: z.string().trim().max(60).optional(),
        country: z.string().regex(/^[A-Z]{2}$/).optional(),
        mine: z.enum(["true", "false"]).optional()
      }).merge(page).parse(request.query);
      return {
        communities: await communities.list({
          userId: me(request), q: q.q || undefined, category: q.category || undefined,
          countryCode: q.country, mine: q.mine === "true", limit: q.limit, offset: q.offset
        })
      };
    }));

    api.post("/", strictWrite, guard(async (request, reply) => {
      const body = createBody.parse(request.body);
      const community = await communities.create({ ownerUserId: me(request), ...body });
      return reply.code(201).send({ community });
    }));

    api.post("/invites/redeem", redeemLimit, guard(async (request) => {
      const body = z.object({ token: z.string().min(20).max(100) }).strict().parse(request.body);
      return communities.redeemInvite(body.token, me(request));
    }));

    api.get("/:id", guard(async (request) => {
      const { id: communityId } = z.object({ id }).parse(request.params);
      return { community: await communities.get(communityId, me(request)) };
    }));

    api.post("/:id/join", strictWrite, guard(async (request, reply) => {
      const { id: communityId } = z.object({ id }).parse(request.params);
      const result = await communities.join(communityId, me(request));
      return reply.code(result.status === "pending" ? 202 : 200).send(result);
    }));

    api.post("/:id/leave", strictWrite, guard(async (request, reply) => {
      const { id: communityId } = z.object({ id }).parse(request.params);
      await communities.leave(communityId, me(request));
      return reply.code(204).send();
    }));

    api.get("/:id/members", guard(async (request) => {
      const { id: communityId } = z.object({ id }).parse(request.params);
      const p = page.parse(request.query);
      return { members: await communities.members(communityId, me(request), p.limit, p.offset) };
    }));

    api.patch("/:id/members/:userId/role", strictWrite, guard(async (request) => {
      const params = z.object({ id, userId: id }).parse(request.params);
      const body = z.object({ role: z.enum(["ADMIN", "MODERATOR", "MEMBER"]) }).strict().parse(request.body);
      return communities.changeRole(params.id, me(request), params.userId, body.role);
    }));

    for (const [action, ban] of [["remove", false], ["ban", true]] as const) {
      api.post(`/:id/members/:userId/${action}`, strictWrite, guard(async (request, reply) => {
        const params = z.object({ id, userId: id }).parse(request.params);
        await communities.removeMember(params.id, me(request), params.userId, ban);
        return reply.code(204).send();
      }));
    }

    api.get("/:id/requests", guard(async (request) => {
      const { id: communityId } = z.object({ id }).parse(request.params);
      return { requests: await communities.listJoinRequests(communityId, me(request)) };
    }));

    for (const [action, approve] of [["approve", true], ["reject", false]] as const) {
      api.post(`/:id/requests/:requestId/${action}`, strictWrite, guard(async (request) => {
        const params = z.object({ id, requestId: id }).parse(request.params);
        return communities.decideJoinRequest(params.id, params.requestId, me(request), approve);
      }));
    }

    api.get("/:id/invites", guard(async (request) => {
      const { id: communityId } = z.object({ id }).parse(request.params);
      return { invites: await communities.listInvites(communityId, me(request)) };
    }));

    api.post("/:id/invites", strictWrite, guard(async (request, reply) => {
      const { id: communityId } = z.object({ id }).parse(request.params);
      const body = z.object({
        expiresInHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
        maxUses: z.number().int().min(1).max(1000).default(1)
      }).strict().parse(request.body ?? {});
      return reply.code(201).send({ invite: await communities.createInvite(communityId, me(request), body) });
    }));

    api.delete("/:id/invites/:inviteId", strictWrite, guard(async (request, reply) => {
      const params = z.object({ id, inviteId: id }).parse(request.params);
      await communities.revokeInvite(params.id, params.inviteId, me(request));
      return reply.code(204).send();
    }));

    api.get("/:id/announcements", guard(async (request) => {
      const { id: communityId } = z.object({ id }).parse(request.params);
      const p = page.parse(request.query);
      return { announcements: await communities.listAnnouncements(communityId, me(request), p.limit, p.offset) };
    }));

    api.post("/:id/announcements", strictWrite, guard(async (request, reply) => {
      const { id: communityId } = z.object({ id }).parse(request.params);
      const body = z.object({
        body: z.string().trim().min(1).max(10_000),
        pinned: z.boolean().default(false)
      }).strict().parse(request.body);
      return reply.code(201).send({ announcement: await communities.createAnnouncement(communityId, me(request), body) });
    }));
  }, { prefix: "/api/communities" });
}

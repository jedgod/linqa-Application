import { createHash, randomBytes } from "node:crypto";
import type { Database } from "../db/pool.js";
import { contentScopePredicate, viewerScopeCte } from "./countrylinqa/feed-scope.js";

export type CommunityVisibility = "PRIVATE" | "INVITE_ONLY" | "PUBLIC";
export type CommunityRole = "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER";

export type CommunityErrorCode =
  | "not_found"
  | "forbidden"
  | "membership_denied"
  | "invite_required"
  | "owner_cannot_leave"
  | "request_not_pending"
  | "limit_reached";

/** `not_found` doubles as the answer for "exists but you may not know it exists" so private communities do not leak. */
export class CommunityError extends Error {
  constructor(readonly code: CommunityErrorCode) {
    super(code);
  }
}

const RANK: Record<CommunityRole, number> = { OWNER: 4, ADMIN: 3, MODERATOR: 2, MEMBER: 1 };
const MODERATING: readonly CommunityRole[] = ["OWNER", "ADMIN", "MODERATOR"];
export const MAX_OWNED_COMMUNITIES = 20;

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
/** `%`, `_` and `\` are literal in a user's search text. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

type Queryable = Pick<Database, "query">;

export class CommunityService {
  constructor(private readonly db: Database) {}

  async create(input: {
    ownerUserId: string;
    name: string;
    visibility: CommunityVisibility;
    description?: string | undefined;
    category?: string | undefined;
    countryCode?: string | null | undefined;
    rules?: string | undefined;
  }) {
    return this.tx(async (client) => {
      const owned = await client.query(
        "SELECT count(*)::int AS n FROM communities WHERE owner_user_id=$1 AND status='ACTIVE'",
        [input.ownerUserId]
      );
      if (owned.rows[0].n >= MAX_OWNED_COMMUNITIES) throw new CommunityError("limit_reached");

      const community = await client.query(
        `INSERT INTO communities (owner_user_id, name, visibility, description, category, country_code, rules)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, name, description, category, visibility, country_code, rules, created_at`,
        [
          input.ownerUserId,
          input.name,
          input.visibility,
          input.description ?? "",
          input.category ?? "general",
          input.countryCode ?? null,
          input.rules ?? ""
        ]
      );
      const row = community.rows[0];

      await client.query(
        "INSERT INTO community_memberships (community_id, user_id, role) VALUES ($1,$2,'OWNER')",
        [row.id, input.ownerUserId]
      );
      await this.audit(client, row.id, input.ownerUserId, "community.created");
      return row;
    });
  }

  async createChannel(input: {
    communityId: string;
    name: string;
    channelType:
      | "CHAT"
      | "ANNOUNCEMENT"
      | "VOICE_STAGE"
      | "EVENT"
      | "SUPPORT";
    visibility: "PUBLIC" | "MEMBERS" | "ADMINS";
  }) {
    const result = await this.db.query(
      `INSERT INTO community_channels (
         community_id,
         name,
         channel_type,
         visibility
       ) VALUES ($1,$2,$3,$4)
       RETURNING id, created_at`,
      [
        input.communityId,
        input.name,
        input.channelType,
        input.visibility
      ]
    );

    return result.rows[0];
  }

  // ---- discovery ---------------------------------------------------------------------------------------------------

  /**
   * Public communities plus the viewer's own. A community scoped to a country is shown to non-members only inside the
   * viewer's CountryLinqa discovery scope (the same predicate people, events and country communities use); a community
   * without a country is global. Member locations are never read or returned.
   */
  async list(input: {
    userId: string;
    q?: string | undefined;
    category?: string | undefined;
    countryCode?: string | undefined;
    mine?: boolean | undefined;
    limit: number;
    offset: number;
  }) {
    const result = await this.db.query(
      `WITH ${viewerScopeCte(1)}
       SELECT c.id, c.name, c.description, c.category, c.visibility, c.country_code, c.created_at,
              (SELECT count(*)::int FROM community_memberships m
                WHERE m.community_id=c.id AND m.status='ACTIVE') AS member_count,
              me.role AS my_role,
              (SELECT r.status FROM community_join_requests r
                WHERE r.community_id=c.id AND r.user_id=$1) AS my_request_status
       FROM communities c
       LEFT JOIN community_memberships me
         ON me.community_id=c.id AND me.user_id=$1 AND me.status='ACTIVE'
       WHERE c.status='ACTIVE'
         AND (c.visibility='PUBLIC' OR me.user_id IS NOT NULL)
         AND ($2::text IS NULL OR c.name ILIKE $2 ESCAPE '\\')
         AND ($3::text IS NULL OR c.category=$3)
         AND ($4::text IS NULL OR c.country_code=$4)
         AND (NOT $5::boolean OR me.user_id IS NOT NULL)
         AND (
           c.country_code IS NULL
           OR me.user_id IS NOT NULL
           OR EXISTS (
             SELECT 1 FROM viewer_scope vs
             JOIN countries cc ON cc.code=c.country_code
             WHERE vs.allow_communities=TRUE AND ${contentScopePredicate("c.country_code", "cc.region_code")}
           )
         )
       ORDER BY c.created_at DESC, c.id
       LIMIT $6 OFFSET $7`,
      [
        input.userId,
        input.q ? likePattern(input.q) : null,
        input.category ?? null,
        input.countryCode ?? null,
        input.mine === true,
        input.limit,
        input.offset
      ]
    );
    return result.rows;
  }

  /** Explicit public-safe field list; storage keys and owner identity are not returned. */
  async get(communityId: string, userId: string) {
    const result = await this.db.query(
      `SELECT c.id, c.name, c.description, c.category, c.visibility, c.country_code, c.rules, c.created_at,
              (SELECT count(*)::int FROM community_memberships m
                WHERE m.community_id=c.id AND m.status='ACTIVE') AS member_count,
              me.role AS my_role
       FROM communities c
       LEFT JOIN community_memberships me
         ON me.community_id=c.id AND me.user_id=$2 AND me.status='ACTIVE'
       WHERE c.id=$1 AND c.status='ACTIVE'
         AND (c.visibility='PUBLIC' OR me.user_id IS NOT NULL)`,
      [communityId, userId]
    );
    if (!result.rows[0]) throw new CommunityError("not_found");
    return result.rows[0];
  }

  // ---- membership --------------------------------------------------------------------------------------------------

  async join(communityId: string, userId: string): Promise<{ status: "joined" | "pending" }> {
    return this.tx(async (client) => {
      const community = await this.lockCommunity(client, communityId);
      const existing = await client.query(
        "SELECT status FROM community_memberships WHERE community_id=$1 AND user_id=$2",
        [communityId, userId]
      );
      const status = existing.rows[0]?.status as string | undefined;

      if (status === "BANNED" || status === "SUSPENDED") throw new CommunityError("membership_denied");
      if (status === "ACTIVE") return { status: "joined" };
      if (community.visibility === "INVITE_ONLY") throw new CommunityError("invite_required");

      if (community.visibility === "PRIVATE") {
        await client.query(
          `INSERT INTO community_join_requests (community_id, user_id) VALUES ($1,$2)
           ON CONFLICT (community_id, user_id)
           DO UPDATE SET status='PENDING', reviewed_by=NULL, reviewed_at=NULL
           WHERE community_join_requests.status <> 'PENDING'`,
          [communityId, userId]
        );
        return { status: "pending" };
      }

      await this.activate(client, communityId, userId);
      return { status: "joined" };
    });
  }

  async leave(communityId: string, userId: string) {
    await this.tx(async (client) => {
      await this.lockCommunity(client, communityId);
      const role = await this.roleOf(client, communityId, userId);
      if (!role) throw new CommunityError("not_found");
      if (role === "OWNER") throw new CommunityError("owner_cannot_leave");
      await client.query(
        "UPDATE community_memberships SET status='REMOVED' WHERE community_id=$1 AND user_id=$2",
        [communityId, userId]
      );
    });
  }

  async members(communityId: string, actorId: string, limit: number, offset: number) {
    await this.requireRole(this.db, communityId, actorId);
    const result = await this.db.query(
      `SELECT user_id, role, created_at AS joined_at
       FROM community_memberships
       WHERE community_id=$1 AND status='ACTIVE'
       ORDER BY created_at, user_id LIMIT $2 OFFSET $3`,
      [communityId, limit, offset]
    );
    return result.rows;
  }

  async listJoinRequests(communityId: string, actorId: string) {
    await this.requireRole(this.db, communityId, actorId, MODERATING);
    const result = await this.db.query(
      `SELECT id, user_id, status, created_at FROM community_join_requests
       WHERE community_id=$1 AND status='PENDING' ORDER BY created_at LIMIT 100`,
      [communityId]
    );
    return result.rows;
  }

  async decideJoinRequest(communityId: string, requestId: string, actorId: string, approve: boolean) {
    return this.tx(async (client) => {
      await this.lockCommunity(client, communityId);
      await this.requireRole(client, communityId, actorId, MODERATING);

      const request = await client.query(
        "SELECT user_id, status FROM community_join_requests WHERE id=$1 AND community_id=$2 FOR UPDATE",
        [requestId, communityId]
      );
      if (!request.rows[0]) throw new CommunityError("not_found");
      if (request.rows[0].status !== "PENDING") throw new CommunityError("request_not_pending");

      const applicant = request.rows[0].user_id as string;
      if (approve) {
        const current = await client.query(
          "SELECT status FROM community_memberships WHERE community_id=$1 AND user_id=$2",
          [communityId, applicant]
        );
        const status = current.rows[0]?.status;
        if (status === "BANNED" || status === "SUSPENDED") throw new CommunityError("membership_denied");
        if (status !== "ACTIVE") await this.activate(client, communityId, applicant);
      }

      await client.query(
        `UPDATE community_join_requests
         SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1`,
        [requestId, approve ? "APPROVED" : "REJECTED", actorId]
      );
      await this.audit(client, communityId, actorId, approve ? "join_request.approved" : "join_request.rejected", applicant);
      return { status: approve ? "approved" : "rejected" };
    });
  }

  /**
   * Role changes need the actor to outrank both the target's current role and the role being granted, so an admin cannot
   * promote anyone to admin, touch the owner, or act on a peer. Rows are locked in id order so concurrent changes by two
   * actors cannot interleave around a stale read.
   */
  async changeRole(communityId: string, actorId: string, targetId: string, role: Exclude<CommunityRole, "OWNER">) {
    return this.tx(async (client) => {
      await this.lockCommunity(client, communityId);
      const { actor, target } = await this.lockActorAndTarget(client, communityId, actorId, targetId);
      if (actorId === targetId) throw new CommunityError("forbidden");
      if (RANK[actor] < RANK.ADMIN || RANK[actor] <= RANK[target] || RANK[actor] <= RANK[role]) {
        throw new CommunityError("forbidden");
      }
      await client.query(
        "UPDATE community_memberships SET role=$3 WHERE community_id=$1 AND user_id=$2",
        [communityId, targetId, role]
      );
      await this.audit(client, communityId, actorId, "member.role_changed", targetId, { from: target, to: role });
      return { userId: targetId, role };
    });
  }

  /** Removal lets the person rejoin where joining is allowed; a ban does not. */
  async removeMember(communityId: string, actorId: string, targetId: string, ban: boolean) {
    await this.tx(async (client) => {
      await this.lockCommunity(client, communityId);
      const { actor, target } = await this.lockActorAndTarget(client, communityId, actorId, targetId);
      if (actorId === targetId) throw new CommunityError("forbidden");
      if (RANK[actor] < RANK.MODERATOR || RANK[actor] <= RANK[target]) throw new CommunityError("forbidden");
      await client.query(
        "UPDATE community_memberships SET status=$3 WHERE community_id=$1 AND user_id=$2",
        [communityId, targetId, ban ? "BANNED" : "REMOVED"]
      );
      await this.audit(client, communityId, actorId, ban ? "member.banned" : "member.removed", targetId);
    });
  }

  // ---- invitations -------------------------------------------------------------------------------------------------

  /** The token is returned once; only its SHA-256 is stored. */
  async createInvite(communityId: string, actorId: string, input: { expiresInHours: number; maxUses: number }) {
    return this.tx(async (client) => {
      await this.requireRole(client, communityId, actorId, MODERATING);
      const token = randomBytes(32).toString("base64url");
      const result = await client.query(
        `INSERT INTO community_invites (community_id, created_by, token_hash, expires_at, max_uses)
         VALUES ($1,$2,$3, now() + make_interval(hours => $4::int), $5)
         RETURNING id, expires_at, max_uses`,
        [communityId, actorId, hashToken(token), input.expiresInHours, input.maxUses]
      );
      await this.audit(client, communityId, actorId, "invite.created", result.rows[0].id);
      return { id: result.rows[0].id, token, expiresAt: result.rows[0].expires_at, maxUses: result.rows[0].max_uses };
    });
  }

  async listInvites(communityId: string, actorId: string) {
    await this.requireRole(this.db, communityId, actorId, MODERATING);
    const result = await this.db.query(
      `SELECT id, created_by, expires_at, max_uses, uses, revoked_at, created_at
       FROM community_invites WHERE community_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [communityId]
    );
    return result.rows;
  }

  async revokeInvite(communityId: string, inviteId: string, actorId: string) {
    await this.tx(async (client) => {
      await this.requireRole(client, communityId, actorId, MODERATING);
      const result = await client.query(
        `UPDATE community_invites SET revoked_at=now()
         WHERE id=$1 AND community_id=$2 AND revoked_at IS NULL`,
        [inviteId, communityId]
      );
      if (!result.rowCount) throw new CommunityError("not_found");
      await this.audit(client, communityId, actorId, "invite.revoked", inviteId);
    });
  }

  /**
   * Unknown, expired, revoked and used-up tokens all answer `not_found`, so a caller cannot probe which tokens ever existed.
   * The invite row is locked, so two people racing for the last use cannot both get it; someone who is already a member
   * does not spend a use.
   */
  async redeemInvite(token: string, userId: string) {
    return this.tx(async (client) => {
      const invite = await client.query(
        `SELECT i.id, i.community_id, i.uses, i.max_uses
         FROM community_invites i JOIN communities c ON c.id=i.community_id AND c.status='ACTIVE'
         WHERE i.token_hash=$1 AND i.revoked_at IS NULL AND i.expires_at > now()
         FOR UPDATE OF i`,
        [hashToken(token)]
      );
      const row = invite.rows[0];
      if (!row) throw new CommunityError("not_found");

      await this.lockCommunity(client, row.community_id);
      const existing = await client.query(
        "SELECT status FROM community_memberships WHERE community_id=$1 AND user_id=$2",
        [row.community_id, userId]
      );
      const status = existing.rows[0]?.status as string | undefined;
      if (status === "BANNED" || status === "SUSPENDED") throw new CommunityError("membership_denied");
      if (status === "ACTIVE") return { communityId: row.community_id as string, status: "joined" as const };
      if (row.uses >= row.max_uses) throw new CommunityError("not_found");

      await this.activate(client, row.community_id, userId);
      await client.query("UPDATE community_invites SET uses=uses+1 WHERE id=$1", [row.id]);
      await client.query(
        "UPDATE community_join_requests SET status='APPROVED', reviewed_at=now() WHERE community_id=$1 AND user_id=$2 AND status='PENDING'",
        [row.community_id, userId]
      );
      await this.audit(client, row.community_id, userId, "invite.redeemed", row.id);
      return { communityId: row.community_id as string, status: "joined" as const };
    });
  }

  // ---- announcements -----------------------------------------------------------------------------------------------

  async listAnnouncements(communityId: string, actorId: string, limit: number, offset: number) {
    await this.requireRole(this.db, communityId, actorId);
    const result = await this.db.query(
      `SELECT id, author_id, body, pinned, created_at FROM community_posts
       WHERE community_id=$1 AND kind='ANNOUNCEMENT' AND deleted_at IS NULL
       ORDER BY pinned DESC, created_at DESC, id LIMIT $2 OFFSET $3`,
      [communityId, limit, offset]
    );
    return result.rows;
  }

  async createAnnouncement(communityId: string, actorId: string, input: { body: string; pinned: boolean }) {
    return this.tx(async (client) => {
      await this.requireRole(client, communityId, actorId, MODERATING);
      const result = await client.query(
        `INSERT INTO community_posts (community_id, author_id, kind, body, pinned)
         VALUES ($1,$2,'ANNOUNCEMENT',$3,$4)
         RETURNING id, author_id, body, pinned, created_at`,
        [communityId, actorId, input.body, input.pinned]
      );
      await this.audit(client, communityId, actorId, "announcement.created", result.rows[0].id);
      return result.rows[0];
    });
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  private async tx<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Serialises membership changes per community, so join / approve / ban / leave cannot interleave. */
  private async lockCommunity(client: Queryable, communityId: string): Promise<{ visibility: CommunityVisibility }> {
    const result = await client.query(
      "SELECT visibility FROM communities WHERE id=$1 AND status='ACTIVE' FOR UPDATE",
      [communityId]
    );
    if (!result.rows[0]) throw new CommunityError("not_found");
    return result.rows[0];
  }

  private async roleOf(db: Queryable, communityId: string, userId: string): Promise<CommunityRole | undefined> {
    const result = await db.query(
      `SELECT m.role FROM community_memberships m JOIN communities c ON c.id=m.community_id AND c.status='ACTIVE'
       WHERE m.community_id=$1 AND m.user_id=$2 AND m.status='ACTIVE'`,
      [communityId, userId]
    );
    return result.rows[0]?.role;
  }

  /**
   * Non-members get `not_found` (a private community is not confirmed to exist); members who lack the role get `forbidden`.
   */
  private async requireRole(db: Queryable, communityId: string, userId: string, allowed?: readonly CommunityRole[]) {
    const role = await this.roleOf(db, communityId, userId);
    if (!role) throw new CommunityError("not_found");
    if (allowed && !allowed.includes(role)) throw new CommunityError("forbidden");
    return role;
  }

  private async lockActorAndTarget(client: Queryable, communityId: string, actorId: string, targetId: string) {
    const result = await client.query(
      `SELECT user_id, role FROM community_memberships
       WHERE community_id=$1 AND user_id = ANY($2::uuid[]) AND status='ACTIVE'
       ORDER BY user_id FOR UPDATE`,
      [communityId, [actorId, targetId]]
    );
    const roles = new Map<string, CommunityRole>(result.rows.map((r: { user_id: string; role: CommunityRole }) => [r.user_id, r.role]));
    const actor = roles.get(actorId);
    const target = roles.get(targetId);
    if (!actor) throw new CommunityError("not_found");
    if (!target) throw new CommunityError("not_found");
    return { actor, target };
  }

  /** Only a REMOVED row is reactivated; banned and suspended rows are never overwritten here. */
  private async activate(client: Queryable, communityId: string, userId: string) {
    await client.query(
      `INSERT INTO community_memberships (community_id, user_id, role, status) VALUES ($1,$2,'MEMBER','ACTIVE')
       ON CONFLICT (community_id, user_id)
       DO UPDATE SET status='ACTIVE', role='MEMBER' WHERE community_memberships.status='REMOVED'`,
      [communityId, userId]
    );
  }

  private async audit(
    client: Queryable,
    communityId: string,
    actorId: string,
    action: string,
    targetId?: string,
    detail: Record<string, unknown> = {}
  ) {
    await client.query(
      "INSERT INTO community_audit_logs (community_id, actor_id, action, target_id, detail) VALUES ($1,$2,$3,$4,$5)",
      [communityId, actorId, action, targetId ?? null, JSON.stringify(detail)]
    );
  }
}

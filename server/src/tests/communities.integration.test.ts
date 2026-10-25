import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import pg from "pg";
import { SignJWT } from "jose";
import { ensureTestDatabase } from "./support/test-database.js";
import type { AppConfig } from "../config.js";
import { registerCommunityRoutes } from "../routes/communities.js";
import { CommunityService } from "../services/community.service.js";
import type { Database } from "../db/pool.js";

const database = await ensureTestDatabase();
const suite = database ? describe : describe.skip;
const config = { NODE_ENV: "test", JWT_ISSUER: "communities-test", JWT_AUDIENCE: "communities-test", JWT_HS256_SECRET: "communities-test-secret-32-characters!" } as AppConfig;

suite("communities module (real PostgreSQL)", () => {
  let db: Database;
  let app: ReturnType<typeof Fastify>;
  const users: string[] = [];

  beforeAll(async () => {
    db = new pg.Pool({ connectionString: database!.connectionString }) as unknown as Database;
    app = Fastify();
    await registerCommunityRoutes(app, config, db, new CommunityService(db));
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    if (users.length) {
      // communities.owner_user_id has no cascade; memberships, requests, invites, posts and audit rows cascade from the community.
      await db.query("DELETE FROM communities WHERE owner_user_id = ANY($1::uuid[])", [users]);
      await db.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
    }
    await (db as unknown as pg.Pool).end();
  });

  const SCOPE = "communities:read communities:write";
  async function person(label: string, scope = SCOPE) {
    const id = randomUUID();
    users.push(id);
    await db.query("INSERT INTO users(id,external_subject,status) VALUES($1,$2,'ACTIVE')", [id, `communities-${label}-${id}`]);
    const token = await new SignJWT({ user_id: id, scope }).setProtectedHeader({ alg: "HS256" }).setSubject(id)
      .setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setExpirationTime("5m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
    return { id, headers: { authorization: `Bearer ${token}` } };
  }
  type Person = Awaited<ReturnType<typeof person>>;

  const call = (who: Person, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) =>
    app.inject({
      method, url: `/api/communities${url}`,
      headers: body === undefined ? who.headers : { ...who.headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) })
    });
  const json = (response: { body: string }) => JSON.parse(response.body);

  async function community(owner: Person, over: Record<string, unknown> = {}) {
    const response = await call(owner, "POST", "/", { name: `Test ${randomUUID().slice(0, 8)}`, category: "technology", ...over });
    expect(response.statusCode).toBe(201);
    return json(response).community.id as string;
  }
  async function joinAs(who: Person, communityId: string, role?: "ADMIN" | "MODERATOR", owner?: Person) {
    expect((await call(who, "POST", `/${communityId}/join`)).statusCode).toBe(200);
    if (role) expect((await call(owner!, "PATCH", `/${communityId}/members/${who.id}/role`, { role })).statusCode).toBe(200);
  }

  describe("authentication", () => {
    it("rejects missing, invalid and wrong-scope credentials", async () => {
      expect((await app.inject({ method: "GET", url: "/api/communities" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/api/communities", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
      const readOnly = await person("readonly", "communities:read");
      expect((await call(readOnly, "GET", "/")).statusCode).toBe(200);
      expect((await call(readOnly, "POST", "/", { name: "Nope nope" })).statusCode).toBe(403);
      const other = await person("other-scope", "profile:read");
      expect((await call(other, "GET", "/")).statusCode).toBe(403);
    });
  });

  describe("creation and discovery", () => {
    it("creates a community with an owner membership and an audit row, and validates input", async () => {
      const owner = await person("owner");
      const id = await community(owner, { description: "hello", countryCode: "CA" });
      const mine = json(await call(owner, "GET", "/?mine=true")).communities;
      expect(mine).toEqual([expect.objectContaining({ id, my_role: "OWNER", member_count: 1, country_code: "CA" })]);
      const audit = await db.query("SELECT action, actor_id FROM community_audit_logs WHERE community_id=$1", [id]);
      expect(audit.rows).toEqual([{ action: "community.created", actor_id: owner.id }]);

      for (const body of [{ name: "ab" }, { name: "Valid name", visibility: "public" }, { name: "Valid name", countryCode: "usa" }, { name: "Valid name", owner_user_id: owner.id }]) {
        expect((await call(owner, "POST", "/", body)).statusCode).toBe(400);
      }
    });

    it("lists public communities, hides private ones from outsiders, and treats % and _ in search literally", async () => {
      const owner = await person("disco-owner"), stranger = await person("disco-stranger");
      const tag = randomUUID().slice(0, 8);
      const pub = await community(owner, { name: `Pub ${tag}` });
      const priv = await community(owner, { name: `Priv ${tag}`, visibility: "PRIVATE" });
      const hidden = await community(owner, { name: `Inv ${tag}`, visibility: "INVITE_ONLY" });

      const seen = (json(await call(stranger, "GET", `/?q=${tag}`)).communities as { id: string }[]).map((c) => c.id);
      expect(seen).toEqual([pub]);
      const own = (json(await call(owner, "GET", `/?q=${tag}`)).communities as { id: string }[]).map((c) => c.id);
      expect(own.sort()).toEqual([pub, priv, hidden].sort());

      expect(json(await call(stranger, "GET", "/?q=%25")).communities).toEqual([]);
      expect(json(await call(stranger, "GET", "/?q=_")).communities).toEqual([]);
      expect((await call(stranger, "GET", "/?limit=1000")).statusCode).toBe(400);
    });

    it("hides country-scoped communities from viewers outside their CountryLinqa scope, but not from members", async () => {
      const owner = await person("geo-owner"), viewer = await person("geo-viewer");
      const tag = randomUUID().slice(0, 8);
      const scoped = await community(owner, { name: `Scoped ${tag}`, countryCode: "NG" });
      const global = await community(owner, { name: `Global ${tag}` });
      // The viewer has no verified country, so no discovery scope: country-scoped communities stay out of discovery.
      const ids = (json(await call(viewer, "GET", `/?q=${tag}`)).communities as { id: string }[]).map((c) => c.id);
      expect(ids).toEqual([global]);
      expect(json(await call(owner, "GET", `/?q=${tag}`)).communities).toHaveLength(2);
      expect(scoped).toBeTruthy();
    });

    it("returns a public-safe detail view and 404s private communities for non-members", async () => {
      const owner = await person("detail-owner"), stranger = await person("detail-stranger");
      const pub = await community(owner), priv = await community(owner, { visibility: "PRIVATE" });
      const detail = json(await call(stranger, "GET", `/${pub}`)).community;
      expect(Object.keys(detail).sort()).toEqual(["category", "country_code", "created_at", "description", "id", "member_count", "my_role", "name", "rules", "visibility"]);
      expect(detail.my_role).toBeNull();
      expect((await call(stranger, "GET", `/${priv}`)).statusCode).toBe(404);
      expect((await call(stranger, "GET", `/${randomUUID()}`)).statusCode).toBe(404);
      expect((await call(stranger, "GET", "/not-a-uuid")).statusCode).toBe(400);
    });
  });

  describe("membership", () => {
    it("joins public communities idempotently and keeps member lists members-only", async () => {
      const owner = await person("m-owner"), member = await person("m-member"), stranger = await person("m-stranger");
      const id = await community(owner);
      await joinAs(member, id);
      await joinAs(member, id);
      expect(json(await call(owner, "GET", `/${id}`)).community.member_count).toBe(2);
      expect(json(await call(member, "GET", `/${id}/members`)).members).toHaveLength(2);
      expect((await call(stranger, "GET", `/${id}/members`)).statusCode).toBe(404);
    });

    it("sends private joins to a request that only a moderator or above can decide", async () => {
      const owner = await person("p-owner"), mod = await person("p-mod"), member = await person("p-member"), applicant = await person("p-applicant");
      const id = await community(owner, { visibility: "PRIVATE" });
      // Join the private community as mod/member through invites (private communities cannot be self-joined).
      for (const [who, role] of [[mod, "MODERATOR"], [member, undefined]] as const) {
        const invite = json(await call(owner, "POST", `/${id}/invites`, { maxUses: 1 })).invite;
        expect((await call(who, "POST", "/invites/redeem", { token: invite.token })).statusCode).toBe(200);
        if (role) expect((await call(owner, "PATCH", `/${id}/members/${who.id}/role`, { role })).statusCode).toBe(200);
      }

      const pending = await call(applicant, "POST", `/${id}/join`);
      expect(pending.statusCode).toBe(202);
      expect(json(pending)).toEqual({ status: "pending" });
      expect((await call(applicant, "POST", `/${id}/join`)).statusCode).toBe(202);
      expect((await call(applicant, "GET", `/${id}`)).statusCode).toBe(404);

      const requests = json(await call(mod, "GET", `/${id}/requests`)).requests;
      expect(requests).toHaveLength(1);
      expect((await call(member, "GET", `/${id}/requests`)).statusCode).toBe(403);
      expect((await call(member, "POST", `/${id}/requests/${requests[0].id}/approve`)).statusCode).toBe(403);
      expect((await call(applicant, "POST", `/${id}/requests/${requests[0].id}/approve`)).statusCode).toBe(404);

      expect((await call(mod, "POST", `/${id}/requests/${requests[0].id}/approve`)).statusCode).toBe(200);
      expect((await call(mod, "POST", `/${id}/requests/${requests[0].id}/approve`)).statusCode).toBe(409);
      expect((await call(applicant, "GET", `/${id}`)).statusCode).toBe(200);
      expect(json(await call(owner, "GET", `/${id}/members`)).members).toHaveLength(4);
    });

    it("refuses self-service joins to invite-only communities and lets a rejected request be re-opened", async () => {
      const owner = await person("i-owner"), joiner = await person("i-joiner"), applicant = await person("i-applicant");
      const invOnly = await community(owner, { visibility: "INVITE_ONLY" });
      const res = await call(joiner, "POST", `/${invOnly}/join`);
      expect(res.statusCode).toBe(403);
      expect(json(res).error).toBe("invite_required");

      const priv = await community(owner, { visibility: "PRIVATE" });
      await call(applicant, "POST", `/${priv}/join`);
      const [{ id: requestId }] = json(await call(owner, "GET", `/${priv}/requests`)).requests;
      expect((await call(owner, "POST", `/${priv}/requests/${requestId}/reject`)).statusCode).toBe(200);
      expect((await call(applicant, "GET", `/${priv}`)).statusCode).toBe(404);
      expect((await call(applicant, "POST", `/${priv}/join`)).statusCode).toBe(202);
      expect(json(await call(owner, "GET", `/${priv}/requests`)).requests).toHaveLength(1);
    });

    it("lets members leave, keeps the owner in place, and allows a returning member to rejoin a public community", async () => {
      const owner = await person("l-owner"), member = await person("l-member");
      const id = await community(owner);
      expect((await call(owner, "POST", `/${id}/leave`)).statusCode).toBe(409);
      await joinAs(member, id);
      expect((await call(member, "POST", `/${id}/leave`)).statusCode).toBe(204);
      expect((await call(member, "GET", `/${id}/members`)).statusCode).toBe(404);
      expect((await call(member, "POST", `/${id}/leave`)).statusCode).toBe(404);
      await joinAs(member, id);
      expect(json(await call(member, "GET", `/${id}`)).community.my_role).toBe("MEMBER");
    });
  });

  describe("roles and moderation", () => {
    it("enforces the role hierarchy on role changes", async () => {
      const owner = await person("r-owner"), admin = await person("r-admin"), mod = await person("r-mod"), member = await person("r-member");
      const id = await community(owner);
      await joinAs(admin, id, "ADMIN", owner);
      await joinAs(mod, id, "MODERATOR", owner);
      await joinAs(member, id);
      const role = (who: Person, target: Person, r: string) => call(who, "PATCH", `/${id}/members/${target.id}/role`, { role: r });

      expect((await role(mod, member, "MODERATOR")).statusCode).toBe(403);   // moderators cannot manage roles
      expect((await role(member, member, "ADMIN")).statusCode).toBe(403);    // no self-promotion
      expect((await role(admin, admin, "MEMBER")).statusCode).toBe(403);     // no self-change
      expect((await role(admin, member, "ADMIN")).statusCode).toBe(403);     // admins cannot mint admins
      expect((await role(admin, owner, "MEMBER")).statusCode).toBe(403);     // nobody touches the owner
      expect((await role(owner, owner, "ADMIN")).statusCode).toBe(403);
      expect((await role(admin, mod, "MEMBER")).statusCode).toBe(200);       // admins manage lower roles
      expect((await role(admin, member, "MODERATOR")).statusCode).toBe(200);
      expect((await call(owner, "PATCH", `/${id}/members/${member.id}/role`, { role: "OWNER" })).statusCode).toBe(400);
      expect((await role(owner, { id: randomUUID() } as Person, "MEMBER")).statusCode).toBe(404);

      const actions = await db.query("SELECT action FROM community_audit_logs WHERE community_id=$1 AND action='member.role_changed'", [id]);
      expect(actions.rowCount).toBeGreaterThanOrEqual(4);
    });

    it("bans stay banned across rejoin and invite redemption, and nobody bans a peer or superior", async () => {
      const owner = await person("b-owner"), admin = await person("b-admin"), mod = await person("b-mod"), member = await person("b-member");
      const id = await community(owner);
      await joinAs(admin, id, "ADMIN", owner);
      await joinAs(mod, id, "MODERATOR", owner);
      await joinAs(member, id);

      expect((await call(mod, "POST", `/${id}/members/${admin.id}/ban`)).statusCode).toBe(403);
      expect((await call(mod, "POST", `/${id}/members/${owner.id}/ban`)).statusCode).toBe(403);
      expect((await call(mod, "POST", `/${id}/members/${mod.id}/ban`)).statusCode).toBe(403);
      expect((await call(member, "POST", `/${id}/members/${mod.id}/ban`)).statusCode).toBe(403);
      expect((await call(mod, "POST", `/${id}/members/${member.id}/ban`)).statusCode).toBe(204);

      const rejoin = await call(member, "POST", `/${id}/join`);
      expect(rejoin.statusCode).toBe(403);
      expect(json(rejoin).error).toBe("membership_denied");
      const invite = json(await call(owner, "POST", `/${id}/invites`, { maxUses: 5 })).invite;
      expect((await call(member, "POST", "/invites/redeem", { token: invite.token })).statusCode).toBe(403);
      expect((await call(member, "GET", `/${id}/members`)).statusCode).toBe(404);
      const row = await db.query("SELECT status FROM community_memberships WHERE community_id=$1 AND user_id=$2", [id, member.id]);
      expect(row.rows[0].status).toBe("BANNED");
    });

    it("removal lets a person rejoin a public community", async () => {
      const owner = await person("rm-owner"), member = await person("rm-member");
      const id = await community(owner);
      await joinAs(member, id);
      expect((await call(owner, "POST", `/${id}/members/${member.id}/remove`)).statusCode).toBe(204);
      expect((await call(member, "GET", `/${id}/members`)).statusCode).toBe(404);
      await joinAs(member, id);
    });
  });

  describe("invitations", () => {
    it("stores only a hash, redeems once per use, and rejects replay, revocation and expiry identically", async () => {
      const owner = await person("v-owner"), a = await person("v-a"), b = await person("v-b"), c = await person("v-c");
      const id = await community(owner, { visibility: "INVITE_ONLY" });

      const invite = json(await call(owner, "POST", `/${id}/invites`, { maxUses: 1 })).invite;
      expect(invite.token.length).toBeGreaterThanOrEqual(40);
      const stored = await db.query("SELECT token_hash FROM community_invites WHERE id=$1", [invite.id]);
      expect(stored.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.rows[0].token_hash).not.toContain(invite.token);

      expect((await call(a, "POST", "/invites/redeem", { token: invite.token })).statusCode).toBe(200);
      expect(json(await call(a, "POST", "/invites/redeem", { token: invite.token }))).toEqual({ communityId: id, status: "joined" }); // already a member: no second use
      const replay = await call(b, "POST", "/invites/redeem", { token: invite.token });
      expect(replay.statusCode).toBe(404);
      expect((await call(b, "GET", `/${id}`)).statusCode).toBe(404);

      const revoked = json(await call(owner, "POST", `/${id}/invites`, { maxUses: 5 })).invite;
      expect((await call(owner, "DELETE", `/${id}/invites/${revoked.id}`)).statusCode).toBe(204);
      const afterRevoke = await call(b, "POST", "/invites/redeem", { token: revoked.token });
      expect(afterRevoke.statusCode).toBe(404);

      const expiring = json(await call(owner, "POST", `/${id}/invites`, { maxUses: 5 })).invite;
      await db.query("UPDATE community_invites SET expires_at = now() - interval '1 minute', created_at = now() - interval '2 minutes' WHERE id=$1", [expiring.id]);
      const afterExpiry = await call(b, "POST", "/invites/redeem", { token: expiring.token });
      expect(afterExpiry.body).toBe(afterRevoke.body);
      expect(afterExpiry.body).toBe(replay.body);

      expect((await call(b, "POST", "/invites/redeem", { token: "x".repeat(43) })).statusCode).toBe(404);
      expect((await call(b, "POST", "/invites/redeem", { token: "short" })).statusCode).toBe(400);
      expect((await call(c, "POST", `/${id}/invites`, {})).statusCode).toBe(404);
      expect((await call(a, "POST", `/${id}/invites`, {})).statusCode).toBe(403); // plain members cannot invite
      expect((await call(owner, "POST", `/${id}/invites`, { maxUses: 0 })).statusCode).toBe(400);
      expect((await call(owner, "POST", `/${id}/invites`, { expiresInHours: 24 * 365 })).statusCode).toBe(400);
      expect(json(await call(owner, "GET", `/${id}/invites`)).invites[0]).not.toHaveProperty("token_hash");
    });

    it("never lets more people redeem than max_uses, even concurrently", async () => {
      const owner = await person("cc-owner");
      const id = await community(owner, { visibility: "INVITE_ONLY" });
      const invite = json(await call(owner, "POST", `/${id}/invites`, { maxUses: 3 })).invite;
      const racers = await Promise.all(Array.from({ length: 8 }, (_, i) => person(`cc-${i}`)));
      const results = await Promise.all(racers.map((who) => call(who, "POST", "/invites/redeem", { token: invite.token })));
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(3);
      expect(results.filter((r) => r.statusCode === 404)).toHaveLength(5);
      const row = await db.query("SELECT uses FROM community_invites WHERE id=$1", [invite.id]);
      expect(row.rows[0].uses).toBe(3);
      expect(json(await call(owner, "GET", `/${id}`)).community.member_count).toBe(4);
    });

    it("stays consistent when joins race a ban", async () => {
      const owner = await person("race-owner"), target = await person("race-target");
      const id = await community(owner);
      await joinAs(target, id);
      const results = await Promise.all([
        call(owner, "POST", `/${id}/members/${target.id}/ban`),
        call(target, "POST", `/${id}/join`),
        call(target, "POST", `/${id}/leave`)
      ]);
      expect(results.every((r) => [200, 204, 403, 404].includes(r.statusCode))).toBe(true);
      const row = await db.query("SELECT status FROM community_memberships WHERE community_id=$1 AND user_id=$2", [id, target.id]);
      // A ban that succeeded is final whatever the other two requests did; one that lost the race (target already gone) is not applied.
      if (results[0]!.statusCode === 204) expect(row.rows[0].status).toBe("BANNED");
      else expect(["ACTIVE", "REMOVED"]).toContain(row.rows[0].status);
    });
  });

  describe("announcements", () => {
    it("lets moderators publish, members read (pinned first), and keeps outsiders out", async () => {
      const owner = await person("a-owner"), mod = await person("a-mod"), member = await person("a-member"), stranger = await person("a-stranger");
      const id = await community(owner);
      await joinAs(mod, id, "MODERATOR", owner);
      await joinAs(member, id);

      expect((await call(member, "POST", `/${id}/announcements`, { body: "hi" })).statusCode).toBe(403);
      expect((await call(stranger, "POST", `/${id}/announcements`, { body: "hi" })).statusCode).toBe(404);
      expect((await call(mod, "POST", `/${id}/announcements`, { body: "   " })).statusCode).toBe(400);
      expect((await call(mod, "POST", `/${id}/announcements`, { body: "x", kind: "POST" })).statusCode).toBe(400);
      expect((await call(mod, "POST", `/${id}/announcements`, { body: "first" })).statusCode).toBe(201);
      expect((await call(mod, "POST", `/${id}/announcements`, { body: "pinned one", pinned: true })).statusCode).toBe(201);
      expect((await call(owner, "POST", `/${id}/announcements`, { body: "latest" })).statusCode).toBe(201);

      const read = json(await call(member, "GET", `/${id}/announcements`)).announcements as { body: string; pinned: boolean }[];
      expect(read.map((a) => a.body)).toEqual(["pinned one", "latest", "first"]);
      expect((await call(stranger, "GET", `/${id}/announcements`)).statusCode).toBe(404);
    });
  });

  describe("limits", () => {
    it("caps how many active communities one person can own", async () => {
      const owner = await person("cap-owner");
      for (let i = 0; i < 20; i++) await community(owner, { name: `Cap ${i} ${randomUUID().slice(0, 6)}` });
      const over = await call(owner, "POST", "/", { name: "One too many" });
      expect(over.statusCode).toBe(409);
      expect(json(over).error).toBe("limit_reached");
    });
  });
});

import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../db/pool.js";
import type { AppConfig } from "../config.js";
import { MemoryCache } from "../services/countrylinqa/final/cache.js";
import { cursorKey } from "../services/countrylinqa/engine/cursor.js";
import { AdvancedDiscoveryService } from "../services/countrylinqa/engine/people.js";
import { validateFilters } from "../services/countrylinqa/engine/filters.js";
import { discoverEvents } from "../services/countrylinqa/golive/eventRanking.js";
import { blockedAccounts, countryHub, personDetails, setEventInterest, subscriptionSummary, unblockAccount, worldCountries, worldHome } from "../services/countrylinqa/world.js";

const url = process.env.DATABASE_URL;
const required = process.env.LINQA_REQUIRE_DB_TESTS === "1";
const run = url || required ? describe : describe.skip;

run("Linqa World read models against the database", () => {
  const pool = new pg.Pool({ connectionString: url });
  const db = pool as unknown as Database;
  const users: string[] = [];

  async function makeUser(opts: { country?: string | null; name?: string; verified?: boolean; city?: string; state?: string; showCity?: boolean; showCountry?: boolean; showState?: boolean; interests?: string[]; profession?: string | null; discoverable?: boolean; bio?: string } = {}) {
    const id = randomUUID();
    const country = opts.country === undefined ? "US" : opts.country;
    await pool.query(
      `INSERT INTO users (id, external_subject, status, verified_country_code, country_verification_state, city, state_region, show_city, location_precision)
       VALUES ($1,$2,'ACTIVE',$3,$4,$5,$6,$7,$8)`,
      [id, `world-${id}`, country, country && opts.verified !== false ? "VERIFIED" : "UNVERIFIED", opts.city ?? null, opts.state ?? null, opts.showCity ?? false, opts.showCity ? "CITY" : "COUNTRY"]
    );
    await pool.query("INSERT INTO user_profiles (user_id, display_name, bio) VALUES ($1,$2,$3)", [id, opts.name ?? "Person", opts.bio ?? null]);
    if (opts.showCountry !== undefined || opts.showState !== undefined) {
      await pool.query("INSERT INTO country_discovery_preferences (user_id, show_country, show_state) VALUES ($1,$2,$3)", [id, opts.showCountry ?? true, opts.showState ?? false]);
    }
    if (opts.interests || opts.profession !== undefined || opts.discoverable !== undefined) {
      await pool.query("INSERT INTO countrylinqa_user_discovery_features (user_id, interests, profession_code, discoverable) VALUES ($1,$2,$3,$4)", [id, opts.interests ?? [], opts.profession ?? null, opts.discoverable ?? true]);
    }
    users.push(id);
    return id;
  }

  async function makeEvent(owner: string, country = "US", title = "Music Festival") {
    const id = randomUUID();
    await pool.query("INSERT INTO events (id, owner_user_id, title, starts_at, status, country_code, region_code, city) SELECT $1,$2,$3, now() + interval '3 days','PUBLISHED',$4,c.region_code,'Austin' FROM countries c WHERE c.code=$4", [id, owner, title, country]);
    return id;
  }
  async function makeBusiness(owner: string, country = "US", name = "Sunset Restaurant") {
    const id = randomUUID();
    await pool.query("INSERT INTO businesses (id, owner_user_id, name, category, status) VALUES ($1,$2,$3,'restaurant','ACTIVE')", [id, owner, name]);
    await pool.query("INSERT INTO business_geo_targets (business_id, target_type, country_code) VALUES ($1,'COUNTRY',$2)", [id, country]);
    return id;
  }

  afterAll(async () => {
    if (users.length) await pool.query("DELETE FROM users WHERE id = ANY($1)", [users]);
    await pool.end();
  });

  it("shows people in scope with what they chose to show, in the order asked", async () => {
    const viewer = await makeUser({ name: "Viewer" });
    const olivia = await makeUser({ name: "Olivia Johnson", city: "New York", state: "NY", showCity: true, showState: true, showCountry: true, interests: ["photography", "travel"], profession: "photographer", bio: "Photography and travel." });
    const liam = await makeUser({ name: "Liam Anderson" });
    const rows = await personDetails(db, viewer, [liam, olivia]);
    expect(rows.map((r) => r.displayName)).toEqual(["Liam Anderson", "Olivia Johnson"]);
    expect(rows[1]).toMatchObject({ countryCode: "US", countryName: "United States", city: "New York", state: "NY", professionCode: "photographer", interests: ["photography", "travel"], bio: "Photography and travel.", verified: true, connection: null });
    expect(rows[0]).toMatchObject({ city: null, state: null, interests: [], professionCode: null });
  });

  it("hides what a person keeps private", async () => {
    const viewer = await makeUser();
    const hidden = await makeUser({ name: "Private Pat", city: "Austin", state: "TX", showCity: true, showState: true, showCountry: false });
    const [row] = await personDetails(db, viewer, [hidden]);
    expect(row).toMatchObject({ countryCode: null, countryName: null, state: null, city: null });
    const stateOff = await makeUser({ city: "Austin", state: "TX", showCity: true, showCountry: true, showState: false });
    expect((await personDetails(db, viewer, [stateOff]))[0]).toMatchObject({ state: null, city: "Austin" });
  });

  it("leaves out people outside the viewer's reach, blocked people, opted-out people and the viewer", async () => {
    const viewer = await makeUser();
    const foreign = await makeUser({ country: "GH" });
    const blocked = await makeUser();
    const optedOut = await makeUser({ discoverable: false });
    const visible = await makeUser();
    await pool.query("INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1,$2)", [blocked, viewer]);
    const rows = await personDetails(db, viewer, [foreign, blocked, optedOut, viewer, visible]);
    expect(rows.map((r) => r.id)).toEqual([visible]);
  });

  it("an unverified viewer sees no one", async () => {
    const viewer = await makeUser({ verified: false });
    const other = await makeUser();
    expect(await personDetails(db, viewer, [other])).toEqual([]);
    expect(await worldHome(db, viewer)).toMatchObject({ verified: false, trending: [] });
  });

  it("reports an existing connection, and who asked", async () => {
    const viewer = await makeUser();
    const friend = await makeUser();
    await pool.query("INSERT INTO contact_requests (sender_user_id, recipient_user_id, status) VALUES ($1,$2,'PENDING')", [viewer, friend]);
    expect((await personDetails(db, viewer, [friend]))[0]!.connection).toMatchObject({ status: "PENDING", incoming: false });
    expect((await personDetails(db, friend, [viewer]))[0]!.connection).toMatchObject({ status: "PENDING", incoming: true });
  });

  it("refuses nothing and returns nothing for an empty or oversized ask", async () => {
    const viewer = await makeUser();
    expect(await personDetails(db, viewer, [])).toEqual([]);
    const many = Array.from({ length: 80 }, () => randomUUID());
    expect(await personDetails(db, viewer, many)).toEqual([]);
  });

  it("trending is the most common interests among people in the viewer's country", async () => {
    const viewer = await makeUser({ interests: ["music"] });
    await makeUser({ interests: ["technology", "travel"] });
    await makeUser({ interests: ["technology", "music"] });
    await makeUser({ interests: ["technology"], discoverable: false });
    await makeUser({ country: "GH", interests: ["fishing"] });
    const home = await worldHome(db, viewer);
    expect(home.country).toEqual({ code: "US", name: "United States" });
    expect(home.verified).toBe(true);
    const tags = Object.fromEntries(home.trending.map((t) => [t.tag, t.people]));
    expect(tags.technology).toBeGreaterThanOrEqual(2);
    expect(tags.fishing).toBeUndefined();
    expect(home.trending[0]!.people).toBeGreaterThanOrEqual(home.trending.at(-1)!.people);
  });

  it("countries lists the viewer's own country and, within reach, the popular ones and their regions", async () => {
    const viewer = await makeUser();
    await pool.query("INSERT INTO country_discovery_preferences (user_id, mode) VALUES ($1,'GLOBAL') ON CONFLICT (user_id) DO UPDATE SET mode='GLOBAL'", [viewer]);
    await pool.query("INSERT INTO subscription_accounts (user_id, provider, status, plan_code) VALUES ($1,'MANUAL','ACTIVE','ELITE') ON CONFLICT (user_id) DO UPDATE SET status='ACTIVE', plan_code='ELITE'", [viewer]);
    // Foreign people also have to let the world find them.
    const ghana = await makeUser({ country: "GH" });
    const ghana2 = await makeUser({ country: "GH" });
    for (const id of [ghana, ghana2]) await pool.query("INSERT INTO country_discovery_preferences (user_id, inbound_reach) VALUES ($1,'GLOBAL') ON CONFLICT (user_id) DO UPDATE SET inbound_reach='GLOBAL'", [id]);
    for (const id of [ghana, ghana2]) await pool.query("INSERT INTO subscription_accounts (user_id, provider, status, plan_code) VALUES ($1,'MANUAL','ACTIVE','ELITE') ON CONFLICT (user_id) DO NOTHING", [id]);
    const result = await worldCountries(db, viewer);
    expect(result.yours).toEqual({ code: "US", name: "United States" });
    const gh = result.popular.find((c) => c.code === "GH");
    expect(gh).toMatchObject({ name: "Ghana" });
    expect(gh!.members).toBeGreaterThanOrEqual(2);
    expect(result.popular.find((c) => c.code === "US")).toBeUndefined();
    expect(result.regions.map((r) => r.code)).toContain("AF-W");
    await pool.query("DELETE FROM subscription_accounts WHERE user_id = ANY($1)", [[viewer, ghana, ghana2]]);
  });

  it("people who hide their country are not counted under any country", async () => {
    const viewer = await makeUser();
    await makeUser({ showCountry: false });
    const result = await worldCountries(db, viewer);
    expect(result.popular.every((c) => c.code !== "US")).toBe(true);
  });

  describe("Country Hub", () => {
    it("counts what is in reach and offers featured people, trending interests and the community", async () => {
      const viewer = await makeUser();
      const bio = await makeUser({ name: "Kwame Asante", bio: "Tech entrepreneur.", interests: ["technology", "business"], profession: "tech entrepreneur" });
      await makeUser({ name: "No Bio" });
      await makeEvent(bio); await makeEvent(bio, "US", "Tech Conference");
      await makeBusiness(bio);
      await pool.query("INSERT INTO country_community_memberships (user_id, country_code, membership_type, status) VALUES ($1,'US','MANUAL','ACTIVE') ON CONFLICT DO NOTHING", [bio]);
      const hub = await countryHub(db, viewer, "us");
      expect(hub).toBeTruthy();
      expect(hub!.country).toMatchObject({ code: "US", name: "United States", regionCode: "NA" });
      expect(hub!.inScope).toBe(true);
      expect(hub!.stats.people).toBeGreaterThanOrEqual(2);
      expect(hub!.stats.events).toBeGreaterThanOrEqual(2);
      expect(hub!.stats.businesses).toBeGreaterThanOrEqual(1);
      expect(hub!.stats.members).toBeGreaterThanOrEqual(1);
      // People with a bio come first, whoever else is in the database.
      expect(hub!.featured[0]!.bio).toBeTruthy();
      expect(hub!.featured.map((p) => !!p.bio)).toEqual([...hub!.featured.map((p) => !!p.bio)].sort((a, b) => Number(b) - Number(a)));
      expect(hub!.featured.length).toBeLessThanOrEqual(3);
      expect(hub!.trending.map((t) => t.tag)).toEqual(expect.arrayContaining(["technology"]));
      expect(hub!.community).toMatchObject({ joined: false, suspended: false });
    });

    it("shows nothing about a country outside the viewer's reach, and nothing for an unknown country", async () => {
      const viewer = await makeUser();
      await makeUser({ country: "GH", name: "Ama" });
      const hub = await countryHub(db, viewer, "GH");
      expect(hub).toMatchObject({ inScope: false, stats: { people: 0, members: 0, events: 0, businesses: 0 }, featured: [], trending: [] });
      expect(hub!.country.name).toBe("Ghana");
      expect(await countryHub(db, viewer, "ZZ")).toBeNull();
    });

    it("an unverified viewer is out of reach everywhere", async () => {
      const viewer = await makeUser({ verified: false });
      expect((await countryHub(db, viewer, "US"))!.inScope).toBe(false);
    });

    it("reports whether the viewer has joined the community", async () => {
      const viewer = await makeUser();
      await pool.query("INSERT INTO country_community_memberships (user_id, country_code, membership_type, status) VALUES ($1,'US','MANUAL','ACTIVE')", [viewer]);
      expect((await countryHub(db, viewer, "US"))!.community.joined).toBe(true);
    });
  });

  describe("Event interest", () => {
    it("marks, counts and clears interest, and the list shows it", async () => {
      const owner = await makeUser(); const viewer = await makeUser(); const other = await makeUser();
      const event = await makeEvent(owner, "US", "Interest Test Festival");
      expect(await setEventInterest(db, viewer, event, true)).toEqual({ interested: true, interestedCount: 1 });
      expect(await setEventInterest(db, viewer, event, true)).toEqual({ interested: true, interestedCount: 1 }); // twice is still once
      expect(await setEventInterest(db, other, event, true)).toEqual({ interested: true, interestedCount: 2 });
      const mine = (await discoverEvents(db, viewer, 100, { country: "US", limit: 100, offset: 0, period: "all" } as never)).find((e) => e.id === event)!;
      expect(mine).toMatchObject({ interested: true, interestedCount: 2 });
      const theirs = (await discoverEvents(db, await makeUser(), 100, { country: "US", limit: 100, offset: 0, period: "all" } as never)).find((e) => e.id === event)!;
      expect(theirs.interested).toBe(false);
      expect(await setEventInterest(db, viewer, event, false)).toEqual({ interested: false, interestedCount: 1 });
    });

    it("refuses events the viewer cannot see: out of reach, blocked owner, not published, in the past", async () => {
      const owner = await makeUser(); const viewer = await makeUser(); const ghOwner = await makeUser({ country: "GH" });
      expect(await setEventInterest(db, viewer, await makeEvent(ghOwner, "GH"), true)).toBeNull();
      const blockedOwner = await makeUser();
      const blockedEvent = await makeEvent(blockedOwner);
      await pool.query("INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1,$2)", [viewer, blockedOwner]);
      expect(await setEventInterest(db, viewer, blockedEvent, true)).toBeNull();
      const draft = await makeEvent(owner);
      await pool.query("UPDATE events SET status = 'DRAFT' WHERE id = $1", [draft]);
      expect(await setEventInterest(db, viewer, draft, true)).toBeNull();
      const past = await makeEvent(owner);
      await pool.query("UPDATE events SET starts_at = now() - interval '1 day' WHERE id = $1", [past]);
      expect(await setEventInterest(db, viewer, past, true)).toBeNull();
      expect(await setEventInterest(db, viewer, randomUUID(), true)).toBeNull();
    });
  });

  describe("Advanced search by city", () => {
    const config = { JWT_HS256_SECRET: "test-secret-that-is-at-least-32-bytes-long", COUNTRY_SELECTION_PREMIUM_LIMIT: 20 } as unknown as AppConfig;
    const people = () => new AdvancedDiscoveryService(db, new MemoryCache(), cursorKey(config));

    it("accepts a city filter, trims it, and rejects the wrong type", () => {
      expect(validateFilters({ city: "  Austin " })).toEqual({ city: "Austin" });
      expect(validateFilters({ city: "   " })).toEqual({});
      expect(() => validateFilters({ city: 5 })).toThrow("INVALID_CITY_FILTER");
    });

    it("finds only people who chose to show their city", async () => {
      const viewer = await makeUser();
      const shown = await makeUser({ name: "Shown Sam", city: "Zzyzxville", showCity: true });
      const hidden = await makeUser({ name: "Hidden Hana", city: "Zzyzxville", showCity: false });
      const hiddenCountry = await makeUser({ name: "Quiet Quinn", city: "Zzyzxville", showCity: true, showCountry: false });
      const found = await people().people(viewer, { city: "zzyzx" }, { limit: 20 });
      const ids = found.items.map((p) => p.id);
      expect(ids).toContain(shown);
      expect(ids).not.toContain(hidden);
      expect(ids).not.toContain(hiddenCountry);
    });

    it("treats % and _ in a city as plain text", async () => {
      const viewer = await makeUser();
      await makeUser({ city: "Plainville", showCity: true });
      expect((await people().people(viewer, { city: "%" }, { limit: 20 })).items).toHaveLength(0);
    });
  });

  describe("Subscription summary", () => {
    it("is FREE with no record and only counts an active paid plan", async () => {
      const user = await makeUser();
      expect(await subscriptionSummary(db, user)).toEqual({ tier: "FREE", status: "FREE", provider: null, currentPeriodEnd: null });
      await pool.query("INSERT INTO subscription_accounts (user_id, provider, status, plan_code, current_period_end) VALUES ($1,'STRIPE','ACTIVE','PREMIUM', now() + interval '10 days')", [user]);
      expect(await subscriptionSummary(db, user)).toMatchObject({ tier: "PREMIUM", status: "ACTIVE", provider: "STRIPE" });
      await pool.query("UPDATE subscription_accounts SET status = 'PAST_DUE', plan_code = 'ELITE' WHERE user_id = $1", [user]);
      expect((await subscriptionSummary(db, user)).tier).toBe("FREE");
    });
  });

  describe("Blocked accounts", () => {
    it("lists both block lists once each and unblocks only the caller's own blocks", async () => {
      const me = await makeUser(); const a = await makeUser({ name: "Alice" }); const b = await makeUser({ name: "Bob" }); const c = await makeUser({ name: "Carol" });
      await pool.query("INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1,$2)", [me, a]);
      await pool.query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2)", [me, b]);
      await pool.query("INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1,$2)", [me, c]);
      await pool.query("INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2)", [me, c]); // blocked in both lists
      const other = await makeUser();
      await pool.query("INSERT INTO blocked_users (blocker_user_id, blocked_user_id) VALUES ($1,$2)", [other, me]); // someone else blocked me
      const list = await blockedAccounts(db, me);
      expect(list.map((x) => x.displayName).sort()).toEqual(["Alice", "Bob", "Carol"]);
      expect(await unblockAccount(db, me, c)).toEqual({ unblocked: true });
      expect((await blockedAccounts(db, me)).map((x) => x.displayName).sort()).toEqual(["Alice", "Bob"]);
      expect(await unblockAccount(db, me, c)).toEqual({ unblocked: false });
      expect(await unblockAccount(db, me, other)).toEqual({ unblocked: false }); // theirs, not mine
      expect((await pool.query("SELECT 1 FROM blocked_users WHERE blocker_user_id = $1 AND blocked_user_id = $2", [other, me])).rowCount).toBe(1);
    });
  });
});

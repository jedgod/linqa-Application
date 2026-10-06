import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import type { Database } from "../db/pool.js";
import type { AppConfig } from "../config.js";
import { MemoryCache } from "../services/countrylinqa/final/cache.js";
import { cursorKey } from "../services/countrylinqa/engine/cursor.js";
import { AdvancedDiscoveryService } from "../services/countrylinqa/engine/people.js";
import { DiscoveryControls } from "../services/countrylinqa/engine/controls.js";
import { canExposePerson, type InboundMode, type OutboundMode, type RegionCountries } from "../services/countrylinqa/engine/eligibility.js";
import { refreshRecommendationBatch, runSavedSearchAlerts } from "../services/countrylinqa/engine/jobs.js";
import { saveDiscoveryFeatures } from "../services/countrylinqa/engine/features.js";
import { unifiedSearch } from "../services/countrylinqa/engine/unified-search.js";
import { CountryLinqaService } from "../services/countrylinqa/service.js";
import { ensureTestDatabase } from "./support/test-database.js";

/**
 * Runs the real discovery SQL against PostgreSQL inside ONE transaction that is
 * rolled back at the end (and per test via savepoints), so it leaves nothing
 * behind even on a shared development database. The migration is replayed
 * first; it is idempotent, so a database that already has it is unaffected.
 *
 * The central test compares the SQL's answer with the pure reference model in
 * engine/eligibility.ts for every viewer-mode x candidate-inbound-mode x country
 * x contact combination.
 */
const database = await ensureTestDatabase();
const suite = database ? describe : describe.skip;

const config = { JWT_HS256_SECRET: "test-secret-that-is-at-least-32-bytes-long", COUNTRY_SELECTION_PREMIUM_LIMIT: 20 } as unknown as AppConfig;

let client: pg.PoolClient;
let pool: pg.Pool;
let db: Database;
let savepoint = 0;

/** Maps the service's BEGIN/COMMIT/ROLLBACK onto savepoints so it can run inside the test transaction. */
function shim(c: pg.PoolClient): Database {
  const base = {
    query: (sql: string, params?: unknown[]) => c.query(sql, params as any[]),
    connect: async () => {
      let depth = 0;
      return {
        query: (sql: string, params?: unknown[]) => {
          const text = sql.trim().toUpperCase();
          if (text === "BEGIN") return c.query(`SAVEPOINT svc_${++depth}`);
          if (text === "COMMIT") return c.query(`RELEASE SAVEPOINT svc_${depth--}`);
          if (text === "ROLLBACK") return c.query(`ROLLBACK TO SAVEPOINT svc_${depth}`).then(() => c.query(`RELEASE SAVEPOINT svc_${depth--}`));
          return c.query(sql, params as any[]);
        },
        release: () => undefined
      };
    }
  };
  return base as unknown as Database;
}

async function user(country: string, opts: { plan?: "ELITE" | "PREMIUM"; name?: string; state?: string; bio?: boolean } = {}) {
  const id = randomUUID();
  await client.query(`INSERT INTO users (id, external_subject, status, verified_country_code, country_verification_state) VALUES ($1,$2,'ACTIVE',$3,$4)`,
    [id, `engine-${id}`, country, opts.state ?? "VERIFIED"]);
  await client.query(`INSERT INTO user_profiles (user_id, display_name, bio) VALUES ($1,$2,$3)`, [id, opts.name ?? `User ${id.slice(0, 6)}`, opts.bio ? "hello" : null]);
  if (opts.plan) await client.query(`INSERT INTO subscription_accounts (user_id, provider, status, plan_code) VALUES ($1,'MANUAL','ACTIVE',$2)`, [id, opts.plan]);
  return id;
}

async function prefs(id: string, p: { mode?: string; inbound?: string; enabled?: boolean; countries?: string[]; regions?: string[]; inCountries?: string[]; inRegions?: string[] }) {
  await client.query(
    `INSERT INTO country_discovery_preferences (user_id, mode, inbound_reach, enabled, version) VALUES ($1, $2::country_discovery_mode, $3::country_inbound_reach, $4, 2)
     ON CONFLICT (user_id) DO UPDATE SET mode = EXCLUDED.mode, inbound_reach = EXCLUDED.inbound_reach, enabled = EXCLUDED.enabled, version = country_discovery_preferences.version + 1`,
    [id, p.mode ?? "MY_COUNTRY", p.inbound ?? "MY_COUNTRY", p.enabled ?? true]);
  for (const c of p.countries ?? []) await client.query(`INSERT INTO country_links (user_id, country_code) VALUES ($1,$2)`, [id, c]);
  for (const r of p.regions ?? []) await client.query(`INSERT INTO regional_links (user_id, region_code) VALUES ($1,$2)`, [id, r]);
  for (const c of p.inCountries ?? []) await client.query(`INSERT INTO country_inbound_links (user_id, country_code) VALUES ($1,$2)`, [id, c]);
  for (const r of p.inRegions ?? []) await client.query(`INSERT INTO regional_inbound_links (user_id, region_code) VALUES ($1,$2)`, [id, r]);
}

const contact = (a: string, b: string) =>
  client.query(`INSERT INTO contact_requests (sender_user_id, recipient_user_id, status, message_ciphertext, expires_at) VALUES ($1,$2,'ACCEPTED','x', now() + interval '1 day')`, [a, b]);

function engine() {
  const cache = new MemoryCache();
  return { cache, people: new AdvancedDiscoveryService(db, cache, cursorKey(config)), controls: new DiscoveryControls(db, cache) };
}

async function allIds(people: AdvancedDiscoveryService, viewer: string, filters: unknown = {}) {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await people.people(viewer, filters, { limit: 2, cursor });
    ids.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return ids;
}

suite("CountryLinqa discovery engine (real SQL)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: database!.connectionString, max: 1 });
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(readFileSync(resolve("src/db/migrations/044_countrylinqa_discovery_engine.sql"), "utf8"));
    // A shared dev database may hold real users who would otherwise appear in results.
    // Suspending them is part of this rolled-back transaction, so nothing persists.
    await client.query(`UPDATE users SET status = 'SUSPENDED' WHERE status = 'ACTIVE'`);
    db = shim(client);
  });
  afterAll(async () => {
    await client?.query("ROLLBACK");
    client?.release();
    await pool?.end();
    await database?.stop();
  });
  beforeEach(async () => { await client.query(`SAVEPOINT t${++savepoint}`); });
  afterEach(async () => { await client.query(`ROLLBACK TO SAVEPOINT t${savepoint}`); });

  it("matches the reference eligibility model for every mode, country, inbound setting and contact state", async () => {
    const regions = await client.query(`SELECT region_code, array_agg(code::text) AS codes FROM countries WHERE enabled GROUP BY region_code`);
    const regionCountries: RegionCountries = Object.fromEntries(regions.rows.map((r: any) => [r.region_code, r.codes]));
    const viewer = await user("US", { plan: "ELITE" });
    const candidates: Array<{ id: string; country: string; inbound: InboundMode; contact: boolean }> = [];
    for (const country of ["US", "GH", "NG", "CA"]) {
      for (const inbound of ["MY_COUNTRY", "SELECTED_COUNTRIES", "REGION", "GLOBAL", "CONTACTS_ONLY"] as InboundMode[]) {
        for (const isContact of [false, true]) {
          const id = await user(country, { plan: "ELITE" });
          await prefs(id, { inbound, inCountries: inbound === "SELECTED_COUNTRIES" ? ["US"] : [], inRegions: inbound === "REGION" ? ["NA"] : [] });
          if (isContact) await contact(viewer, id);
          candidates.push({ id, country, inbound, contact: isContact });
        }
      }
    }
    const setups: Array<{ mode: OutboundMode; countries: string[]; regions: string[] }> = [
      { mode: "MY_COUNTRY", countries: [], regions: [] },
      { mode: "SELECTED_COUNTRIES", countries: ["GH", "CA"], regions: [] },
      { mode: "REGION", countries: [], regions: ["AF-W"] },
      { mode: "GLOBAL", countries: [], regions: [] }
    ];
    for (const setup of setups) {
      await client.query(`DELETE FROM country_links WHERE user_id=$1`, [viewer]);
      await client.query(`DELETE FROM regional_links WHERE user_id=$1`, [viewer]);
      await prefs(viewer, { mode: setup.mode, countries: setup.countries, regions: setup.regions });
      const { people } = engine();
      const seen = new Set(await allIds(people, viewer));
      for (const c of candidates) {
        const expected = canExposePerson({
          viewer: { verifiedCountryCode: "US", verified: true, outboundMode: setup.mode, selectedCountries: setup.countries, selectedRegions: setup.regions, verifiedOnly: true, paused: false },
          candidate: { verifiedCountryCode: c.country, verified: true, inboundMode: c.inbound,
            inboundCountries: c.inbound === "SELECTED_COUNTRIES" ? ["US"] : [], inboundRegions: c.inbound === "REGION" ? ["NA"] : [],
            paused: false, discoverable: true, restricted: false },
          relationship: { isExistingContact: c.contact, isBlocked: false },
          regionCountries
        });
        expect(seen.has(c.id), `${setup.mode} viewer vs ${c.country}/${c.inbound}/contact=${c.contact}`).toBe(expected);
      }
    }
  });

  it("hides blocked, paused, undiscoverable, unverified and restricted candidates and a paused viewer sees no one", async () => {
    const viewer = await user("US");
    const ok = await user("US");
    const blocked = await user("US");
    const paused = await user("US"); await prefs(paused, { enabled: false });
    const hidden = await user("US"); await saveDiscoveryFeatures(db, hidden, { languages: [], interests: [], professionCode: null, discoverable: false });
    const unverified = await user("US", { state: "UNVERIFIED" });
    const restricted = await user("US", { state: "RESTRICTED" });
    await client.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2)`, [viewer, blocked]);
    const { people } = engine();
    expect(await allIds(people, viewer)).toEqual([ok]);
    await prefs(viewer, { enabled: false });
    expect((await people.people(viewer, {}, { limit: 10 })).items).toEqual([]);
    void unverified; void restricted;
  });

  it("applies a block immediately even when the ranked pool is cached", async () => {
    const viewer = await user("US"); const a = await user("US"); const b = await user("US");
    const { people } = engine();
    expect((await allIds(people, viewer)).sort()).toEqual([a, b].sort());
    await client.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2)`, [b, viewer]);
    expect(await allIds(people, viewer)).toEqual([a]);
  });

  it("filters only narrow: a country filter outside the viewer's scope returns nothing", async () => {
    const viewer = await user("US"); await user("GH", { plan: "ELITE" });
    const { people } = engine();
    expect(await allIds(people, viewer, { countries: ["GH"] })).toEqual([]);
  });

  it("filters by shared language and interests and ranks overlap first, reporting reasons", async () => {
    const viewer = await user("US");
    await saveDiscoveryFeatures(db, viewer, { languages: ["english"], interests: ["travel", "tech"], professionCode: "engineer", discoverable: true });
    const match = await user("US"); await saveDiscoveryFeatures(db, match, { languages: ["english"], interests: ["travel"], professionCode: "engineer", discoverable: true });
    const other = await user("US"); await saveDiscoveryFeatures(db, other, { languages: ["french"], interests: [], professionCode: null, discoverable: true });
    const { people } = engine();
    const all = await people.people(viewer, {}, { limit: 10 });
    expect(all.items[0]!.id).toBe(match);
    expect(all.items[0]!.reasons).toEqual(expect.arrayContaining(["SHARED_LANGUAGE", "SHARED_INTERESTS", "SIMILAR_PROFESSION"]));
    expect((await people.people(viewer, { languages: ["English"] }, { limit: 10 })).items.map((i) => i.id)).toEqual([match]);
  });

  it("pages every eligible person exactly once and rejects a cursor after a policy change", async () => {
    const viewer = await user("US");
    const made = await Promise.all(Array.from({ length: 7 }, () => user("US")));
    const { people } = engine();
    const first = await people.people(viewer, {}, { limit: 3 });
    expect(first.nextCursor).toBeTruthy();
    const ids = await allIds(people, viewer);
    expect(ids.sort()).toEqual([...made].sort());
    expect(new Set(ids).size).toBe(ids.length);
    await prefs(viewer, { mode: "MY_COUNTRY" });
    await expect(people.people(viewer, {}, { limit: 3, cursor: first.nextCursor! })).rejects.toMatchObject({ code: "CURSOR_STALE" });
    await expect(people.people(viewer, { languages: ["x"] }, { limit: 3, cursor: first.nextCursor! })).rejects.toMatchObject({ code: expect.stringMatching(/CURSOR_/) });
    await expect(people.people(viewer, {}, { limit: 3, cursor: "garbage" })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("stops showing candidates a policy change excludes, without waiting for the cache to expire", async () => {
    const viewer = await user("US", { plan: "ELITE" }); const gh = await user("GH", { plan: "ELITE" }); await prefs(gh, { inbound: "GLOBAL" });
    await prefs(viewer, { mode: "GLOBAL" });
    const { people } = engine();
    expect(await allIds(people, viewer)).toEqual([gh]);
    await prefs(viewer, { mode: "MY_COUNTRY" });
    expect(await allIds(people, viewer)).toEqual([]);
  });

  it("saving preferences bumps the version, audits the change and rejects a stale expectedVersion", async () => {
    const id = await user("US", { plan: "ELITE" });
    const service = new CountryLinqaService(db, config, { getTier: async () => "ELITE" }, {} as any, {} as any);
    const first = await service.savePreferences(id, { mode: "MY_COUNTRY", selectedCountries: [], selectedRegions: [] });
    const second = await service.savePreferences(id, { mode: "GLOBAL", selectedCountries: [], selectedRegions: [], expectedVersion: Number(first.version) });
    expect(Number(second.version)).toBe(Number(first.version) + 1);
    await expect(service.savePreferences(id, { mode: "MY_COUNTRY", selectedCountries: [], selectedRegions: [], expectedVersion: Number(first.version) }))
      .rejects.toMatchObject({ code: "PREFERENCE_VERSION_CONFLICT", status: 409 });
    const audit = await client.query(`SELECT event_type, new_value FROM countrylinqa_user_audit WHERE user_id=$1 AND event_type='DISCOVERY_POLICY_UPDATED'`, [id]);
    expect(audit.rowCount).toBe(2);
    expect(JSON.stringify(audit.rows)).not.toMatch(/phone|latitude|longitude/i);
  });

  it("unified search returns only surfaces' own eligible results", async () => {
    const viewer = await user("US"); const named = await user("US", { name: "Zanzibar Person" }); await user("GH", { plan: "ELITE", name: "Zanzibar Faraway" });
    const { people } = engine();
    const result = await unifiedSearch({ db, people }, viewer, { q: "Zanzibar", types: ["PEOPLE", "POSTS", "EVENTS", "BUSINESSES", "COMMUNITIES"], limit: 10 });
    expect((result.results.PEOPLE as Array<{ id: string }>).map((p) => p.id)).toEqual([named]);
    expect(result.results.POSTS).toEqual([]);
  });

  it("kill switch turns a surface off", async () => {
    const { controls } = engine();
    await expect(controls.available("PEOPLE")).resolves.toBe(true);
    await client.query(`UPDATE countrylinqa_feature_flags SET enabled = FALSE WHERE key = 'countrylinqa.people'`);
    const fresh = engine().controls;
    await expect(fresh.assertAvailable("PEOPLE")).rejects.toMatchObject({ status: 503 });
    await client.query(`UPDATE countrylinqa_feature_flags SET enabled = FALSE WHERE key = 'countrylinqa.enabled'`);
    await expect(engine().controls.available("RECOMMENDATIONS")).resolves.toBe(false);
  });

  it("percentage rollout admits a stable cohort and a missing flag row counts as off", async () => {
    await client.query(`UPDATE countrylinqa_feature_flags SET config = '{"rolloutPercent": 0}'::jsonb WHERE key = 'countrylinqa.people'`);
    const { controls } = engine();
    const id = randomUUID();
    await expect(controls.available("PEOPLE", id)).resolves.toBe(false);
    await expect(controls.available("PEOPLE")).resolves.toBe(true); // surface-wide check ignores cohorts
    await client.query(`UPDATE countrylinqa_feature_flags SET config = '{"rolloutPercent": 100}'::jsonb WHERE key = 'countrylinqa.people'`);
    await expect(engine().controls.available("PEOPLE", id)).resolves.toBe(true);
    await client.query(`DELETE FROM countrylinqa_feature_flags WHERE key = 'countrylinqa.recommendations'`);
    await expect(engine().controls.available("RECOMMENDATIONS", id)).resolves.toBe(false);
  });

  it("recommendation snapshots are rebuilt for users without one and re-checked against blocks on read", async () => {
    const viewer = await user("US"); const a = await user("US"); const b = await user("US");
    const { people, controls } = engine();
    const run = await refreshRecommendationBatch(db, people, controls, 500);
    expect(run.users).toBeGreaterThanOrEqual(3);
    const snap = await client.query(`SELECT candidate_user_id AS id, score, reason_codes AS reasons FROM countrylinqa_recommendation_snapshots WHERE user_id=$1`, [viewer]);
    expect(snap.rows.map((r: any) => r.id).sort()).toEqual([a, b].sort());
    await client.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2)`, [viewer, b]);
    const hydrated = await people.hydrate(viewer, snap.rows.map((r: any) => ({ id: r.id, score: Number(r.score), reasons: r.reasons })));
    expect(hydrated.map((p) => p.id)).toEqual([a]);
  });

  it("saved-search alerts baseline first, then notify with a count only, once per new match", async () => {
    const viewer = await user("US"); await user("US");
    const saved = await client.query(`INSERT INTO countrylinqa_saved_searches (user_id, name, filters, alerts_enabled) VALUES ($1,'All', '{}'::jsonb, TRUE) RETURNING id`, [viewer]);
    const { people, controls } = engine();
    const first = await runSavedSearchAlerts(db, people, controls);
    expect(first).toMatchObject({ searches: 1, notified: 0 });
    await client.query(`UPDATE countrylinqa_saved_searches SET last_run_at = now() - interval '2 hours' WHERE id = $1`, [saved.rows[0].id]);
    await user("US", { name: "Secret Newcomer" });
    const second = await runSavedSearchAlerts(db, engine().people, controls);
    expect(second.notified).toBe(1);
    const outbox = await client.query(`SELECT payload FROM countrylinqa_notification_outbox WHERE user_id = $1 AND notification_type = 'SAVED_SEARCH_MATCH'`, [viewer]);
    expect(outbox.rowCount).toBe(1);
    expect(outbox.rows[0].payload).toEqual({ savedSearchId: saved.rows[0].id, newMatches: 1 });
    expect(JSON.stringify(outbox.rows)).not.toContain("Secret Newcomer");
  });
});

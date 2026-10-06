import type { Database } from "../../db/pool.js";
import { authorScopePredicate, contentScopePredicate, safetyPredicate, viewerScopeCte } from "./feed-scope.js";
import { discoverBusinesses } from "./golive/businessRanking.js";
import { discoverEvents } from "./golive/eventRanking.js";

/**
 * Read models for the Linqa World pages (home, people, person profile, countries).
 *
 * Every query starts from the same two predicates the rest of CountryLinqa uses (the viewer's
 * geographic scope and the safety rules: blocks, restrictions), so a person outside the viewer's
 * reach is as invisible here as in discovery. What a person shows (country, state, city) follows
 * that person's own privacy settings.
 */
export const MAX_DETAIL_IDS = 50;

export interface PersonDetail {
  id: string;
  displayName: string;
  bio: string | null;
  verified: boolean;
  countryCode: string | null;
  countryName: string | null;
  state: string | null;
  city: string | null;
  professionCode: string | null;
  interests: string[];
  connection: { id: string; status: "PENDING" | "ACCEPTED"; incoming: boolean } | null;
}

export async function personDetails(db: Database, viewerId: string, ids: string[]): Promise<PersonDetail[]> {
  const unique = Array.from(new Set(ids)).slice(0, MAX_DETAIL_IDS);
  if (unique.length === 0) return [];
  const { rows } = await db.query(
    `WITH ${viewerScopeCte(1)}
     SELECT author.id, profile.display_name AS "displayName", profile.bio,
            (author.country_verification_state = 'VERIFIED') AS verified,
            CASE WHEN COALESCE(ap.show_country, TRUE) THEN author.verified_country_code END AS "countryCode",
            CASE WHEN COALESCE(ap.show_country, TRUE) THEN c.name END AS "countryName",
            CASE WHEN COALESCE(ap.show_country, TRUE) AND COALESCE(ap.show_state, FALSE) THEN author.state_region END AS state,
            CASE WHEN COALESCE(ap.show_country, TRUE) AND author.show_city AND author.location_precision = 'CITY' THEN author.city END AS city,
            f.profession_code AS "professionCode", COALESCE(f.interests, '{}') AS interests,
            connection.id AS "connectionId", connection.status AS "connectionStatus", (connection.recipient_user_id = $1) AS "connectionIncoming"
       FROM users author
       JOIN user_profiles profile ON profile.user_id = author.id
       LEFT JOIN country_discovery_preferences ap ON ap.user_id = author.id
       LEFT JOIN countries c ON c.code = author.verified_country_code
       LEFT JOIN countrylinqa_user_discovery_features f ON f.user_id = author.id
       CROSS JOIN viewer_scope vs
       LEFT JOIN LATERAL (
         SELECT cr.id, cr.status, cr.recipient_user_id FROM contact_requests cr
          WHERE ((cr.sender_user_id = $1 AND cr.recipient_user_id = author.id) OR (cr.recipient_user_id = $1 AND cr.sender_user_id = author.id))
            AND (cr.status = 'ACCEPTED' OR (cr.status = 'PENDING' AND cr.expires_at > now()))
          ORDER BY (cr.status = 'ACCEPTED') DESC, cr.created_at DESC LIMIT 1
       ) connection ON TRUE
      WHERE author.id = ANY($2::uuid[]) AND author.id <> $1 AND COALESCE(f.discoverable, TRUE)
        AND ${authorScopePredicate("author")} AND ${safetyPredicate("author", 1)}`,
    [viewerId, unique]
  );
  const byId = new Map<string, PersonDetail>(rows.map((r) => [r.id as string, {
    id: r.id as string, displayName: r.displayName as string, bio: (r.bio as string | null) ?? null, verified: r.verified === true,
    countryCode: ((r.countryCode as string | null) ?? null)?.trim() ?? null, countryName: (r.countryName as string | null) ?? null,
    state: (r.state as string | null) ?? null, city: (r.city as string | null) ?? null,
    professionCode: (r.professionCode as string | null) ?? null, interests: (r.interests as string[]) ?? [],
    connection: r.connectionId ? { id: r.connectionId as string, status: r.connectionStatus as "PENDING" | "ACCEPTED", incoming: r.connectionIncoming === true } : null
  }]));
  // Same order as asked, and nothing for people the viewer is not allowed to see.
  return unique.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export async function worldHome(db: Database, viewerId: string) {
  const own = await db.query(
    `SELECT u.verified_country_code AS code, c.name, (u.country_verification_state = 'VERIFIED') AS verified
       FROM users u LEFT JOIN countries c ON c.code = u.verified_country_code WHERE u.id = $1`,
    [viewerId]
  );
  const me = own.rows[0] as { code: string | null; name: string | null; verified: boolean } | undefined;
  // "Trending" is what people in the viewer's own country list as interests, most common first.
  const trending = await db.query(
    `WITH ${viewerScopeCte(1)}
     SELECT tag, count(*)::int AS people
       FROM countrylinqa_user_discovery_features f
       JOIN users author ON author.id = f.user_id
       CROSS JOIN viewer_scope vs
       CROSS JOIN LATERAL unnest(f.interests) AS tag
      WHERE f.discoverable AND author.id <> $1 AND author.verified_country_code = vs.verified_country_code
        AND ${authorScopePredicate("author")} AND ${safetyPredicate("author", 1)}
      GROUP BY tag ORDER BY people DESC, tag LIMIT 8`,
    [viewerId]
  );
  return {
    country: me?.code ? { code: me.code.trim(), name: me.name ?? me.code.trim() } : null,
    verified: me?.verified === true,
    trending: trending.rows.map((r) => ({ tag: r.tag as string, people: r.people as number }))
  };
}

export async function worldCountries(db: Database, viewerId: string) {
  const common = `WITH ${viewerScopeCte(1)}
     SELECT author.verified_country_code AS code, count(*)::int AS members
       FROM users author
       LEFT JOIN country_discovery_preferences ap ON ap.user_id = author.id
       LEFT JOIN countrylinqa_user_discovery_features f ON f.user_id = author.id
       CROSS JOIN viewer_scope vs
      WHERE author.id <> $1 AND COALESCE(ap.show_country, TRUE) AND COALESCE(f.discoverable, TRUE)
        AND ${authorScopePredicate("author")} AND ${safetyPredicate("author", 1)}`;
  const [countries, regions, own] = await Promise.all([
    db.query(`SELECT c.code, c.name, k.members FROM (${common} AND author.verified_country_code <> vs.verified_country_code GROUP BY author.verified_country_code) k
               JOIN countries c ON c.code = k.code ORDER BY k.members DESC, c.name LIMIT 8`, [viewerId]),
    db.query(`SELECT g.code, g.name, sum(k.members)::int AS members FROM (${common} GROUP BY author.verified_country_code) k
               JOIN countries c ON c.code = k.code JOIN geographic_regions g ON g.code = c.region_code AND g.enabled = TRUE
              GROUP BY g.code, g.name ORDER BY members DESC, g.name LIMIT 12`, [viewerId]),
    db.query(`SELECT u.verified_country_code AS code, c.name FROM users u LEFT JOIN countries c ON c.code = u.verified_country_code WHERE u.id = $1`, [viewerId])
  ]);
  const mine = own.rows[0] as { code: string | null; name: string | null } | undefined;
  return {
    yours: mine?.code ? { code: mine.code.trim(), name: mine.name ?? mine.code.trim() } : null,
    popular: countries.rows.map((r) => ({ code: (r.code as string).trim(), name: r.name as string, members: r.members as number })),
    regions: regions.rows.map((r) => ({ code: r.code as string, name: r.name as string, members: r.members as number }))
  };
}

export interface CountryHub {
  country: { code: string; name: string; regionCode: string | null };
  /** False when the country is outside the viewer's discovery reach; nothing else is revealed then. */
  inScope: boolean;
  stats: { people: number; members: number; events: number; businesses: number };
  /** True when a count stopped at the page limit (shown as "100+"). */
  capped: { events: boolean; businesses: boolean };
  community: { joined: boolean; suspended: boolean; available: boolean };
  trending: Array<{ tag: string; people: number }>;
  featured: PersonDetail[];
}

const HUB_LIMIT = 100;

/**
 * Everything the Country Hub shows about one country, through the same reach and safety rules as
 * the rest of CountryLinqa. Events and businesses are counted with the same queries the lists use,
 * so the number on the hub is the number you will find when you open the list.
 */
export async function countryHub(db: Database, viewerId: string, rawCode: string): Promise<CountryHub | null> {
  const code = rawCode.trim().toUpperCase();
  const base = await db.query(
    `WITH ${viewerScopeCte(1)}
     SELECT c.code, c.name, c.region_code AS "regionCode",
            ${contentScopePredicate("c.code", "c.region_code")} AS "inScope",
            COALESCE(m.status = 'ACTIVE', FALSE) AS joined, COALESCE(m.status = 'SUSPENDED', FALSE) AS suspended,
            COALESCE(s.community_enabled, FALSE) AS "communityAvailable",
            (SELECT count(*)::int FROM country_community_memberships x WHERE x.country_code = c.code AND x.status = 'ACTIVE') AS members
       FROM countries c
       CROSS JOIN viewer_scope vs
       LEFT JOIN countrylinqa_country_status s ON s.country_code = c.code
       LEFT JOIN country_community_memberships m ON m.country_code = c.code AND m.user_id = $1
      WHERE c.code = $2 AND c.enabled = TRUE`,
    [viewerId, code]
  );
  const row = base.rows[0];
  if (!row) return null;
  const country = { code: (row.code as string).trim(), name: row.name as string, regionCode: (row.regionCode as string | null) ?? null };
  const empty: CountryHub = {
    country, inScope: false, stats: { people: 0, members: 0, events: 0, businesses: 0 }, capped: { events: false, businesses: false },
    community: { joined: false, suspended: false, available: false }, trending: [], featured: []
  };
  if (row.inScope !== true) return empty;

  const authors = `FROM users author
       JOIN user_profiles profile ON profile.user_id = author.id
       LEFT JOIN country_discovery_preferences ap ON ap.user_id = author.id
       LEFT JOIN countrylinqa_user_discovery_features f ON f.user_id = author.id
       CROSS JOIN viewer_scope vs
      WHERE author.id <> $1 AND author.verified_country_code = $2 AND COALESCE(ap.show_country, TRUE) AND COALESCE(f.discoverable, TRUE)
        AND ${authorScopePredicate("author")} AND ${safetyPredicate("author", 1)}`;
  const [people, trending, featuredIds, events, businesses] = await Promise.all([
    db.query(`WITH ${viewerScopeCte(1)} SELECT count(*)::int AS n ${authors}`, [viewerId, code]),
    db.query(
      `WITH ${viewerScopeCte(1)}
       SELECT tag, count(*)::int AS people
         FROM countrylinqa_user_discovery_features f
         JOIN users author ON author.id = f.user_id
         LEFT JOIN country_discovery_preferences ap ON ap.user_id = author.id
         CROSS JOIN viewer_scope vs
         CROSS JOIN LATERAL unnest(f.interests) AS tag
        WHERE f.discoverable AND author.id <> $1 AND author.verified_country_code = $2 AND COALESCE(ap.show_country, TRUE)
          AND ${authorScopePredicate("author")} AND ${safetyPredicate("author", 1)}
        GROUP BY tag ORDER BY people DESC, tag LIMIT 6`,
      [viewerId, code]
    ),
    // People with a fuller profile first, so the hub shows someone worth meeting.
    db.query(
      `WITH ${viewerScopeCte(1)}
       SELECT author.id ${authors}
        ORDER BY (profile.bio IS NOT NULL AND length(profile.bio) > 0) DESC, (author.country_verification_state = 'VERIFIED') DESC, (f.profession_code IS NOT NULL) DESC, author.id
        LIMIT 3`,
      [viewerId, code]
    ),
    discoverEvents(db, viewerId, HUB_LIMIT, { country: code, limit: HUB_LIMIT, offset: 0, period: "all" } as never),
    discoverBusinesses(db, viewerId, HUB_LIMIT, { country: code, limit: HUB_LIMIT, offset: 0, period: "all" } as never)
  ]);
  const ids = featuredIds.rows.map((r) => r.id as string);
  return {
    country, inScope: true,
    stats: { people: (people.rows[0]?.n as number | undefined) ?? 0, members: row.members as number, events: events.length, businesses: businesses.length },
    capped: { events: events.length >= HUB_LIMIT, businesses: businesses.length >= HUB_LIMIT },
    community: { joined: row.joined === true, suspended: row.suspended === true, available: row.communityAvailable === true },
    trending: trending.rows.map((r) => ({ tag: r.tag as string, people: r.people as number })),
    featured: await personDetails(db, viewerId, ids)
  };
}

/**
 * Marks or clears "Interested" on an event, but only for an event this viewer could see in the
 * list (same reach, safety and country rules). Anything else answers as if it did not exist.
 */
export async function setEventInterest(db: Database, viewerId: string, eventId: string, interested: boolean): Promise<{ interested: boolean; interestedCount: number } | null> {
  const visible = await db.query(
    `WITH ${viewerScopeCte(1)}
     SELECT e.id FROM events e
       JOIN users author ON author.id = e.owner_user_id
       CROSS JOIN viewer_scope vs
       JOIN countries event_country ON event_country.code = e.country_code AND event_country.enabled = TRUE
       JOIN countrylinqa_country_status country_status ON country_status.country_code = e.country_code AND country_status.events_enabled = TRUE
      WHERE e.id = $2 AND e.status = 'PUBLISHED' AND e.starts_at > now() AND vs.allow_events = TRUE
        AND ${contentScopePredicate("e.country_code", "e.region_code")}
        AND ${authorScopePredicate("author")} AND ${safetyPredicate("author", 1)}`,
    [viewerId, eventId]
  );
  if (!visible.rowCount) return null;
  if (interested) await db.query("INSERT INTO country_event_interest (user_id, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [viewerId, eventId]);
  else await db.query("DELETE FROM country_event_interest WHERE user_id = $1 AND event_id = $2", [viewerId, eventId]);
  const count = await db.query("SELECT count(*)::int AS n FROM country_event_interest WHERE event_id = $1", [eventId]);
  return { interested, interestedCount: (count.rows[0]?.n as number | undefined) ?? 0 };
}

export type SubscriptionSummary = {
  tier: "FREE" | "PREMIUM" | "ELITE";
  status: string;
  provider: "APPLE" | "GOOGLE" | "STRIPE" | "MANUAL" | null;
  currentPeriodEnd: string | null;
};

/** The plan as billing last confirmed it. Only an active, trial or grace subscription counts as paid. */
export async function subscriptionSummary(db: Database, userId: string): Promise<SubscriptionSummary> {
  const { rows } = await db.query("SELECT plan_code, status, provider, current_period_end FROM subscription_accounts WHERE user_id = $1", [userId]);
  const r = rows[0];
  if (!r) return { tier: "FREE", status: "FREE", provider: null, currentPeriodEnd: null };
  const paid = ["ACTIVE", "TRIAL", "GRACE"].includes(r.status as string);
  const code = String(r.plan_code ?? "").toUpperCase();
  return {
    tier: paid && code === "ELITE" ? "ELITE" : paid && code === "PREMIUM" ? "PREMIUM" : "FREE",
    status: r.status as string,
    provider: (r.provider as SubscriptionSummary["provider"]) ?? null,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end).toISOString() : null
  };
}

export interface BlockedAccount { userId: string; displayName: string; blockedAt: string }

/** People this user has blocked, from both block lists the app writes to, newest first. */
export async function blockedAccounts(db: Database, userId: string): Promise<BlockedAccount[]> {
  const { rows } = await db.query(
    `SELECT b.blocked_id AS id, COALESCE(p.display_name, 'Linqa user') AS name, max(b.at) AS at FROM (
       SELECT blocked_user_id AS blocked_id, created_at AS at FROM blocked_users WHERE blocker_user_id = $1
       UNION ALL SELECT blocked_id, created_at FROM user_blocks WHERE blocker_id = $1
     ) b LEFT JOIN user_profiles p ON p.user_id = b.blocked_id
     GROUP BY b.blocked_id, p.display_name ORDER BY at DESC LIMIT 200`,
    [userId]
  );
  return rows.map((r) => ({ userId: r.id as string, displayName: r.name as string, blockedAt: new Date(r.at).toISOString() }));
}

/** Lifts only this user's own block. A block the other person placed on them stays. */
export async function unblockAccount(db: Database, userId: string, otherId: string): Promise<{ unblocked: boolean }> {
  const a = await db.query("DELETE FROM blocked_users WHERE blocker_user_id = $1 AND blocked_user_id = $2", [userId, otherId]);
  const b = await db.query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [userId, otherId]);
  return { unblocked: ((a.rowCount ?? 0) + (b.rowCount ?? 0)) > 0 };
}

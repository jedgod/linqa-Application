import type { Database } from "../../../db/pool.js";
import { getCountryFeed } from "../golive/feed.js";
import { discoverBusinesses } from "../golive/businessRanking.js";
import { discoverEvents } from "../golive/eventRanking.js";
import { discoverCommunities } from "../golive/communityDiscovery.js";
import type { CollectionSearch } from "../search.js";
import type { AdvancedDiscoveryService } from "./people.js";

export const SEARCH_TYPES = ["PEOPLE", "POSTS", "EVENTS", "BUSINESSES", "COMMUNITIES"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/**
 * One query across every CountryLinqa surface. It delegates to each surface's
 * own eligibility-enforcing query, so a result appears here only if it would
 * also appear in that surface's own listing: this function adds no scope logic
 * of its own and therefore cannot widen anyone's reach.
 */
export async function unifiedSearch(
  deps: { db: Database; people: AdvancedDiscoveryService },
  userId: string,
  input: { q: string; types: readonly SearchType[]; limit: number }
) {
  const collection: CollectionSearch = { q: input.q, period: "all", limit: input.limit, offset: 0 };
  const results: Record<string, unknown[]> = {};
  const wants = new Set(input.types);

  await Promise.all([
    wants.has("PEOPLE") && deps.people.people(userId, { query: input.q }, { limit: input.limit }).then((r) => { results.PEOPLE = r.items; }),
    wants.has("POSTS") && getCountryFeed(deps.db, userId, input.limit, undefined, { q: input.q }).then((r) => { results.POSTS = r.items; }),
    wants.has("EVENTS") && discoverEvents(deps.db, userId, input.limit, collection).then((rows) => { results.EVENTS = rows.slice(0, input.limit); }),
    wants.has("BUSINESSES") && discoverBusinesses(deps.db, userId, input.limit, collection).then((rows) => { results.BUSINESSES = rows.slice(0, input.limit); }),
    wants.has("COMMUNITIES") && discoverCommunities(deps.db, userId, collection).then((r) => { results.COMMUNITIES = r.rows.slice(0, input.limit); })
  ].filter(Boolean) as Promise<void>[]);

  return { results };
}

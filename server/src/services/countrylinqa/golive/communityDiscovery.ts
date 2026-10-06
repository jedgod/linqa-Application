import type { Database } from "../../../db/pool.js";
import { contentScopePredicate, viewerScopeCte } from "../feed-scope.js";
import type { CollectionSearch } from "../search.js";

/**
 * Country communities visible to a viewer: inside their outbound scope, and
 * only when they have not switched communities off. Shared by the communities
 * route and unified search so both apply identical eligibility.
 */
export async function discoverCommunities(db: Database, userId: string, query: CollectionSearch) {
  return db.query(
    `WITH ${viewerScopeCte(1)}
      SELECT c.code, c.name, c.region_code AS "regionCode",
        (SELECT count(*)::int FROM country_community_memberships members WHERE members.country_code=c.code AND members.status='ACTIVE') AS "memberCount",
        COALESCE(m.status='ACTIVE', FALSE) AS joined, COALESCE(m.status='SUSPENDED', FALSE) AS suspended
      FROM countries c CROSS JOIN viewer_scope vs
      JOIN countrylinqa_country_status s ON s.country_code=c.code AND s.community_enabled=TRUE
      LEFT JOIN country_community_memberships m ON m.country_code=c.code AND m.user_id=$1
      WHERE c.enabled=TRUE AND vs.allow_communities=TRUE AND ${contentScopePredicate("c.code", "c.region_code")}
        AND ($2::text IS NULL OR c.name ILIKE $2) AND ($3::text IS NULL OR c.code=$3)
        AND ($4::text IS NULL OR c.region_code=$4)
      ORDER BY c.name, c.code LIMIT $5 OFFSET $6`,
    [userId, query.q ? `%${query.q}%` : null, query.country ?? null, query.region ?? null, query.limit + 1, query.offset]
  );
}

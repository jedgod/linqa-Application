import type { Database } from "../../db/pool.js";
import { viewerScopeCte, authorScopePredicate, safetyPredicate } from "./feed-scope.js";

export type DiscoverySearchInput = {
  q?: string | undefined;
  country?: string | undefined;
  region?: string | undefined;
  verifiedOnly: boolean;
  onlineOnly: boolean;
  language?: string | undefined;
  limit: number;
  cursor?: string | undefined;
};

export async function discoverUsers(db: Database, requesterId: string, input: DiscoverySearchInput) {
  const params: unknown[] = [requesterId];
  const conditions: string[] = [];

  conditions.push(safetyPredicate("author", 1));
  conditions.push(authorScopePredicate("author"));

  if (input.country) {
    params.push(input.country);
    conditions.push(`author.verified_country_code = $${params.length}`);
  }
  if (input.region) {
    params.push(input.region);
    conditions.push(`EXISTS (SELECT 1 FROM countries c2 WHERE c2.code = author.verified_country_code AND c2.region_code = $${params.length})`);
  }
  if (input.verifiedOnly) {
    conditions.push(`author.country_verification_state = 'VERIFIED'`);
  }
  if (input.language) {
    params.push(input.language);
    conditions.push(`author.preferred_language = $${params.length}`);
  }
  if (input.q) {
    params.push(`%${input.q}%`);
    conditions.push(`profile.display_name ILIKE $${params.length}`);
  }
  if (input.cursor) {
    params.push(input.cursor);
    conditions.push(`author.id > $${params.length}`);
  }

  // input.onlineOnly is accepted but not applied — no presence-tracking
  // table exists in the real schema yet (fails open, i.e. included).

  params.push(input.limit);
  const limitParamIndex = params.length;

  const result = await db.query(
    `WITH ${viewerScopeCte(1)}
     SELECT author.id, profile.display_name, profile.avatar_object_key, author.verified_country_code, author.country_verification_state
     FROM users author
     JOIN user_profiles profile ON profile.user_id = author.id
     CROSS JOIN viewer_scope vs
     WHERE author.status = 'ACTIVE' AND author.id <> $1 AND ${conditions.join(" AND ")}
     ORDER BY author.id
     LIMIT $${limitParamIndex}`,
    params
  );

  const items = result.rows;
  const nextCursor = items.length === input.limit ? items[items.length - 1].id : null;
  return { items, nextCursor };
}

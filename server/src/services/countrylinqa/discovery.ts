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

  if (input.onlineOnly) throw Object.assign(new Error("Online discovery is unavailable"), { status: 422, code: "ONLINE_DISCOVERY_UNAVAILABLE" });

  params.push(input.limit + 1);
  const limitParamIndex = params.length;

  const result = await db.query(
    `WITH ${viewerScopeCte(1)}
     SELECT author.id, profile.display_name, profile.avatar_object_key,
       CASE WHEN COALESCE(author_preferences.show_country, TRUE) THEN author.verified_country_code ELSE NULL END AS verified_country_code,
       author.country_verification_state,
       connection.id AS "connectionId", connection.status AS "connectionStatus",
       (connection.recipient_user_id = $1) AS "connectionIncoming"
     FROM users author
     JOIN user_profiles profile ON profile.user_id = author.id
     LEFT JOIN country_discovery_preferences author_preferences ON author_preferences.user_id=author.id
     CROSS JOIN viewer_scope vs
     LEFT JOIN LATERAL (
       SELECT cr.id, cr.status, cr.recipient_user_id FROM contact_requests cr
       WHERE ((cr.sender_user_id=$1 AND cr.recipient_user_id=author.id)
         OR (cr.recipient_user_id=$1 AND cr.sender_user_id=author.id))
         AND (cr.status='ACCEPTED' OR (cr.status='PENDING' AND cr.expires_at>now()))
       ORDER BY (cr.status='ACCEPTED') DESC,cr.created_at DESC LIMIT 1
     ) connection ON TRUE
     WHERE author.status = 'ACTIVE' AND author.id <> $1 AND ${conditions.join(" AND ")}
     ORDER BY author.id
     LIMIT $${limitParamIndex}`,
    params
  );

  const items = result.rows.slice(0, input.limit);
  const nextCursor = result.rows.length > input.limit ? items[items.length - 1].id : null;
  return { items, nextCursor };
}

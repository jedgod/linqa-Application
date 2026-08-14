import type { Database } from "../../../db/pool.js";
import { viewerScopeCte, authorScopePredicate, safetyPredicate } from "../feed-scope.js";

export async function getCountryFeed(db: Database, userId: string, limit = 30, cursor?: string) {
  const cappedLimit = Math.min(limit, 100);
  const params: unknown[] = [userId];
  let cursorClause = "";
  if (cursor) {
    params.push(cursor);
    cursorClause = ` AND p.id > $${params.length}`;
  }
  params.push(cappedLimit);
  const limitIndex = params.length;

  const result = await db.query(
    `WITH ${viewerScopeCte(1)}
     SELECT
       p.id, p.author_id AS "authorId", p.created_at AS "createdAt", p.body,
       p.country_code AS "countryCode", p.region_code AS "regionCode",
       COALESCE(ps.engagement_score, 0) AS "engagementScore",
       GREATEST(0, 1 - EXTRACT(EPOCH FROM (now() - p.created_at)) / 86400 / 7) AS "freshnessScore",
       COALESCE(aff.score, 0) AS "affinityScore",
       COALESCE(ps.quality_score, 0) AS "qualityScore"
     FROM posts p
     JOIN users author ON author.id = p.author_id
     CROSS JOIN viewer_scope vs
     LEFT JOIN post_scores ps ON ps.post_id = p.id
     LEFT JOIN countrylinqa_user_affinity aff
       ON aff.user_id = $1 AND aff.affinity_type = 'COUNTRY' AND aff.affinity_key = p.country_code
     WHERE p.status = 'PUBLISHED' AND ${safetyPredicate("author", 1)} AND ${authorScopePredicate("author")}${cursorClause}
     ORDER BY (
       COALESCE(ps.engagement_score, 0) * 0.30
       + GREATEST(0, 1 - EXTRACT(EPOCH FROM (now() - p.created_at)) / 86400 / 7) * 0.20
       + COALESCE(aff.score, 0) * 0.30
       + COALESCE(ps.quality_score, 0) * 0.20
     ) DESC, p.id
     LIMIT $${limitIndex}`,
    params
  );

  const items = result.rows;
  const nextCursor = items.length === cappedLimit ? items[items.length - 1].id : null;
  return { items, nextCursor };
}

import type { Database } from "../../../db/pool.js";
import { viewerScopeCte, authorScopePredicate, safetyPredicate } from "../feed-scope.js";
import type { CollectionSearch } from "../search.js";

export async function discoverBusinesses(db: Database, userId: string, limit = 30, query?: CollectionSearch) {
  const params: unknown[] = [userId];
  const filters: string[] = [];
  if (query?.q) { params.push(`%${query.q}%`); filters.push(`b.name ILIKE $${params.length}`); }
  if (query?.category) { params.push(query.category); filters.push(`b.category = $${params.length}`); }
  if (query?.country) { params.push(query.country); filters.push(`t.country_code = $${params.length}`); }
  if (query?.region) { params.push(query.region); filters.push(`(t.region_code = $${params.length} OR target_country.region_code = $${params.length})`); }
  params.push(Math.min(limit, 100) + (query ? 1 : 0), query?.offset ?? 0);
  const result = await db.query(
    `WITH ${viewerScopeCte(1)}
     SELECT b.id, b.name, b.category, b.logo_url AS "logoUrl",
       COALESCE(s.rating_score, 0) AS "ratingScore",
       COALESCE(s.engagement_score, 0) AS "engagementScore",
       MAX(CASE t.target_type WHEN 'COUNTRY' THEN 1.0 WHEN 'STATE' THEN 0.9 WHEN 'REGION' THEN 0.75 ELSE 0 END) AS "geoScore"
     FROM businesses b
     JOIN users author ON author.id = b.owner_user_id
     JOIN business_geo_targets t ON t.business_id = b.id AND t.enabled = TRUE
     CROSS JOIN viewer_scope vs
     LEFT JOIN countries target_country ON target_country.code = t.country_code AND target_country.enabled = TRUE
     JOIN countries owner_country ON owner_country.code = author.verified_country_code AND owner_country.enabled = TRUE
     JOIN countrylinqa_country_status country_status ON country_status.country_code = owner_country.code AND country_status.business_enabled = TRUE
     LEFT JOIN business_scores s ON s.business_id = b.id
     WHERE b.status = 'ACTIVE' AND vs.allow_businesses=TRUE
       AND ${authorScopePredicate("author")} AND ${safetyPredicate("author", 1)}
       AND (
         (t.target_type = 'COUNTRY' AND target_country.code IS NOT NULL AND (
           vs.mode='GLOBAL' OR (vs.mode='MY_COUNTRY' AND t.country_code=vs.verified_country_code)
           OR (vs.mode='SELECTED_COUNTRIES' AND t.country_code=ANY(vs.selected_countries))
           OR (vs.mode='REGION' AND target_country.region_code=ANY(vs.selected_regions))))
         OR (t.target_type = 'REGION' AND EXISTS (
           SELECT 1 FROM countries c WHERE c.enabled=TRUE AND c.region_code=t.region_code AND (
             vs.mode='GLOBAL' OR (vs.mode='MY_COUNTRY' AND c.code=vs.verified_country_code)
             OR (vs.mode='SELECTED_COUNTRIES' AND c.code=ANY(vs.selected_countries))
             OR (vs.mode='REGION' AND c.region_code=ANY(vs.selected_regions)))))
         OR (t.target_type='STATE' AND t.country_code=vs.verified_country_code AND t.state_region=vs.state_region)
       ) ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
     GROUP BY b.id, s.rating_score, s.engagement_score
     ORDER BY (COALESCE(s.rating_score, 0)*0.40 + COALESCE(s.engagement_score, 0)*0.30 +
       MAX(CASE t.target_type WHEN 'COUNTRY' THEN 1.0 WHEN 'STATE' THEN 0.9 WHEN 'REGION' THEN 0.75 ELSE 0 END)*0.30) DESC, b.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params
  );
  return result.rows;
}

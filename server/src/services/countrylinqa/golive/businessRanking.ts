import type { Database } from "../../../db/pool.js";

export async function discoverBusinesses(db: Database, userId: string, limit = 30) {
  const cappedLimit = Math.min(limit, 100);

  const result = await db.query(
    `WITH viewer AS (
       SELECT u.verified_country_code AS country_code,
              COALESCE(p.enabled, TRUE) AS discovery_enabled,
              COALESCE(p.allow_businesses, TRUE) AS allow_businesses
       FROM users u LEFT JOIN country_discovery_preferences p ON p.user_id=u.id
       WHERE u.id = $1
     )
     SELECT
       b.id, b.name, b.category, b.logo_url AS "logoUrl",
       COALESCE(s.rating_score, 0) AS "ratingScore",
       COALESCE(s.engagement_score, 0) AS "engagementScore",
       CASE t.target_type
         WHEN 'COUNTRY' THEN 1.0
         WHEN 'STATE' THEN 0.9
         WHEN 'REGION' THEN 0.75
         ELSE 0
       END AS "geoScore"
     FROM businesses b
     JOIN business_geo_targets t ON t.business_id = b.id AND t.enabled = TRUE
     CROSS JOIN viewer v
     LEFT JOIN countries c ON c.code = v.country_code
     LEFT JOIN business_scores s ON s.business_id = b.id
     WHERE b.status = 'ACTIVE' AND v.discovery_enabled=TRUE AND v.allow_businesses=TRUE
       AND (
         (t.target_type = 'COUNTRY' AND t.country_code = v.country_code)
         OR (t.target_type = 'REGION' AND t.region_code = c.region_code)
         OR (t.target_type = 'STATE' AND t.country_code = v.country_code)
       )
     ORDER BY (COALESCE(s.rating_score, 0) * 0.40 + COALESCE(s.engagement_score, 0) * 0.30 +
       (CASE t.target_type WHEN 'COUNTRY' THEN 1.0 WHEN 'STATE' THEN 0.9 WHEN 'REGION' THEN 0.75 ELSE 0 END) * 0.30) DESC
     LIMIT $2`,
    [userId, cappedLimit]
  );

  return result.rows;
}

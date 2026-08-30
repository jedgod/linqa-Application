import type { Database } from "../../../db/pool.js";

export async function discoverEvents(db: Database, userId: string, limit = 30) {
  const cappedLimit = Math.min(limit, 100);

  const result = await db.query(
    `WITH viewer AS (
       SELECT u.verified_country_code AS country_code,
              COALESCE(p.enabled, TRUE) AS discovery_enabled,
              COALESCE(p.allow_events, TRUE) AS allow_events
       FROM users u LEFT JOIN country_discovery_preferences p ON p.user_id=u.id
       WHERE u.id = $1
     )
     SELECT
       e.id, e.title, e.starts_at AS "startsAt", e.country_code AS "countryCode",
       e.region_code AS "regionCode", e.city, e.popularity_score AS "popularityScore",
       CASE
         WHEN e.country_code = v.country_code THEN 1.0
         WHEN e.region_code = c.region_code THEN 0.7
         ELSE 0.25
       END AS "geoScore"
     FROM events e
     CROSS JOIN viewer v
     LEFT JOIN countries c ON c.code = v.country_code
     WHERE e.status = 'PUBLISHED' AND e.starts_at > now()
       AND v.discovery_enabled=TRUE AND v.allow_events=TRUE
     ORDER BY (e.popularity_score * 0.55 +
       (CASE WHEN e.country_code = v.country_code THEN 1.0 WHEN e.region_code = c.region_code THEN 0.7 ELSE 0.25 END) * 0.45) DESC,
       e.starts_at
     LIMIT $2`,
    [userId, cappedLimit]
  );

  return result.rows;
}

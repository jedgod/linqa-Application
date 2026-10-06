import type { Database } from "../../../db/pool.js";
import { viewerScopeCte, authorScopePredicate, contentScopePredicate, safetyPredicate } from "../feed-scope.js";
import type { CollectionSearch } from "../search.js";

export async function discoverEvents(db: Database, userId: string, limit = 30, query?: CollectionSearch) {
  const cappedLimit = Math.min(limit, 100);
  const params: unknown[] = [userId];
  const filters: string[] = [];
  if (query?.q) { params.push(`%${query.q}%`); filters.push(`e.title ILIKE $${params.length}`); }
  if (query?.country) { params.push(query.country); filters.push(`e.country_code = $${params.length}`); }
  if (query?.region) { params.push(query.region); filters.push(`e.region_code = $${params.length}`); }
  if (query?.period === "week") filters.push(`e.starts_at < now() + interval '7 days'`);
  if (query?.period === "month") filters.push(`e.starts_at < now() + interval '1 month'`);
  params.push(cappedLimit + (query ? 1 : 0), query?.offset ?? 0);

  const result = await db.query(
    `WITH ${viewerScopeCte(1)}
     SELECT
       e.id, e.title, e.starts_at AS "startsAt", e.country_code AS "countryCode",
       e.region_code AS "regionCode", e.city, e.popularity_score AS "popularityScore",
       CASE
         WHEN e.country_code = vs.verified_country_code THEN 1.0
         WHEN e.region_code = c.region_code THEN 0.7
         ELSE 0.25
       END AS "geoScore"
     FROM events e
     JOIN users author ON author.id = e.owner_user_id
     CROSS JOIN viewer_scope vs
     LEFT JOIN countries c ON c.code = vs.verified_country_code
     JOIN countries event_country ON event_country.code = e.country_code AND event_country.enabled = TRUE
     JOIN countrylinqa_country_status country_status ON country_status.country_code = e.country_code AND country_status.events_enabled = TRUE
     WHERE e.status = 'PUBLISHED' AND e.starts_at > now()
       AND vs.allow_events=TRUE AND ${contentScopePredicate("e.country_code", "e.region_code")}
       AND ${authorScopePredicate("author")} AND ${safetyPredicate("author", 1)}
       ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
     ORDER BY (e.popularity_score * 0.55 +
       (CASE WHEN e.country_code = vs.verified_country_code THEN 1.0 WHEN e.region_code = c.region_code THEN 0.7 ELSE 0.25 END) * 0.45) DESC,
       e.starts_at, e.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return result.rows;
}

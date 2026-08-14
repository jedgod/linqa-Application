import type { Database } from "../../db/pool.js";

export async function getFeedScope(db: Database, userId: string) {
  const result = await db.query(
    `SELECT
       u.verified_country_code AS "myCountry",
       COALESCE(p.mode, 'MY_COUNTRY') AS mode,
       COALESCE((
         SELECT json_agg(cl.country_code) FROM country_links cl WHERE cl.user_id = u.id
       ), '[]'::json) AS "selectedCountries",
       COALESCE((
         SELECT json_agg(rl.region_code) FROM regional_links rl WHERE rl.user_id = u.id
       ), '[]'::json) AS "selectedRegions"
     FROM users u
     LEFT JOIN country_discovery_preferences p ON p.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  const row = result.rows[0];
  return {
    mode: row?.mode ?? "MY_COUNTRY",
    myCountry: row?.myCountry ?? null,
    selectedCountries: row?.selectedCountries ?? [],
    selectedRegions: row?.selectedRegions ?? []
  };
}

/**
 * Reusable "author is within viewer's geographic discovery scope" SQL
 * fragment. The two packs (contentPredicates.ts / geoScope.ts) shipped two
 * near-identical copies of this against differently-named CTE aliases;
 * this is the single, real version, parameterized on the CTE alias so both
 * call sites (people discovery, golive feed) can share it.
 */
export function viewerScopeCte(viewerIdParamIndex: number): string {
  return `viewer_scope AS (
    SELECT
      u.id AS viewer_id,
      u.verified_country_code,
      COALESCE(p.mode, 'MY_COUNTRY') AS mode,
      COALESCE((SELECT array_agg(cl.country_code) FROM country_links cl WHERE cl.user_id = u.id), ARRAY[]::text[]) AS selected_countries,
      COALESCE((SELECT array_agg(rl.region_code) FROM regional_links rl WHERE rl.user_id = u.id), ARRAY[]::text[]) AS selected_regions
    FROM users u
    LEFT JOIN country_discovery_preferences p ON p.user_id = u.id
    WHERE u.id = $${viewerIdParamIndex}
  )`;
}

export function authorScopePredicate(authorAlias = "author"): string {
  return `(
    vs.mode = 'GLOBAL'
    OR (vs.mode = 'MY_COUNTRY' AND ${authorAlias}.verified_country_code = vs.verified_country_code)
    OR (vs.mode = 'SELECTED_COUNTRIES' AND ${authorAlias}.verified_country_code = ANY(vs.selected_countries))
    OR (vs.mode = 'REGION' AND EXISTS (
      SELECT 1 FROM countries cscope
      WHERE cscope.code = ${authorAlias}.verified_country_code
        AND cscope.region_code = ANY(vs.selected_regions)
    ))
  )`;
}

export function safetyPredicate(authorAlias = "author", viewerParamIndex = 1): string {
  return `${authorAlias}.status = 'ACTIVE'
    AND ${authorAlias}.country_verification_state <> 'RESTRICTED'
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = $${viewerParamIndex} AND ub.blocked_id = ${authorAlias}.id)
         OR (ub.blocker_id = ${authorAlias}.id AND ub.blocked_id = $${viewerParamIndex})
    )`;
}

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
      u.country_verification_state,
      COALESCE(p.mode, 'MY_COUNTRY') AS mode,
      COALESCE(p.enabled, TRUE) AS discovery_enabled,
      COALESCE(p.verified_only, TRUE) AS verified_only,
      COALESCE((SELECT array_agg(cl.country_code) FROM country_links cl WHERE cl.user_id = u.id), ARRAY[]::text[]) AS selected_countries,
      COALESCE((SELECT array_agg(rl.region_code) FROM regional_links rl WHERE rl.user_id = u.id), ARRAY[]::text[]) AS selected_regions
    FROM users u
    LEFT JOIN country_discovery_preferences p ON p.user_id = u.id
    WHERE u.id = $${viewerIdParamIndex}
  )`;
}

export function authorScopePredicate(authorAlias = "author"): string {
  return `(
    vs.discovery_enabled = TRUE
    AND (vs.verified_only = FALSE OR ${authorAlias}.country_verification_state = 'VERIFIED')
    AND (
      vs.mode = 'GLOBAL'
      OR (vs.mode = 'MY_COUNTRY' AND ${authorAlias}.verified_country_code = vs.verified_country_code)
      OR (vs.mode = 'SELECTED_COUNTRIES' AND ${authorAlias}.verified_country_code = ANY(vs.selected_countries))
      OR (vs.mode = 'REGION' AND EXISTS (
        SELECT 1 FROM countries cscope
        WHERE cscope.code = ${authorAlias}.verified_country_code
          AND cscope.region_code = ANY(vs.selected_regions)
      ))
    )
    AND COALESCE((SELECT ap.enabled FROM country_discovery_preferences ap WHERE ap.user_id=${authorAlias}.id), TRUE)
    AND (
      COALESCE((SELECT ap.inbound_reach::text FROM country_discovery_preferences ap WHERE ap.user_id=${authorAlias}.id), 'MY_COUNTRY') = 'GLOBAL'
      OR (COALESCE((SELECT ap.inbound_reach::text FROM country_discovery_preferences ap WHERE ap.user_id=${authorAlias}.id), 'MY_COUNTRY') = 'MY_COUNTRY'
          AND vs.verified_country_code = ${authorAlias}.verified_country_code)
      OR (COALESCE((SELECT ap.inbound_reach::text FROM country_discovery_preferences ap WHERE ap.user_id=${authorAlias}.id), 'MY_COUNTRY') = 'SELECTED_COUNTRIES'
          AND EXISTS (SELECT 1 FROM country_inbound_links cil WHERE cil.user_id=${authorAlias}.id AND cil.country_code=vs.verified_country_code))
      OR (COALESCE((SELECT ap.inbound_reach::text FROM country_discovery_preferences ap WHERE ap.user_id=${authorAlias}.id), 'MY_COUNTRY') = 'REGION'
          AND EXISTS (
            SELECT 1 FROM countries viewer_country
            JOIN regional_inbound_links ril ON ril.region_code=viewer_country.region_code
            WHERE viewer_country.code=vs.verified_country_code AND ril.user_id=${authorAlias}.id
          ))
      OR (COALESCE((SELECT ap.inbound_reach::text FROM country_discovery_preferences ap WHERE ap.user_id=${authorAlias}.id), 'MY_COUNTRY') = 'CONTACTS_ONLY'
          AND EXISTS (
            SELECT 1 FROM contact_requests cr
            WHERE cr.status='ACCEPTED'
              AND ((cr.sender_user_id=vs.viewer_id AND cr.recipient_user_id=${authorAlias}.id)
                OR (cr.recipient_user_id=vs.viewer_id AND cr.sender_user_id=${authorAlias}.id))
          ))
    )
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

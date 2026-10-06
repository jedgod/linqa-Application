import type { Database } from "../../db/pool.js";

/** Saved reach cannot retain paid permissions after the live entitlement expires. */
function entitledReachSql(mode: string, userId: string) {
  return `(CASE
    WHEN ${mode}='CONTACTS_ONLY' THEN 'CONTACTS_ONLY'
    WHEN EXISTS (SELECT 1 FROM subscription_accounts entitlement WHERE entitlement.user_id=${userId}
      AND entitlement.status IN ('ACTIVE','TRIAL','GRACE') AND upper(entitlement.plan_code)='ELITE') THEN ${mode}
    WHEN ${mode} IN ('SELECTED_COUNTRIES','REGION') AND EXISTS (
      SELECT 1 FROM subscription_accounts entitlement WHERE entitlement.user_id=${userId}
      AND entitlement.status IN ('ACTIVE','TRIAL','GRACE') AND upper(entitlement.plan_code)='PREMIUM') THEN ${mode}
    ELSE 'MY_COUNTRY' END)`;
}

export async function getFeedScope(db: Database, userId: string) {
  const result = await db.query(
    `SELECT
       u.verified_country_code AS "myCountry",
       ${entitledReachSql("COALESCE(p.mode::text, 'MY_COUNTRY')", "u.id")} AS mode,
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
      ${entitledReachSql("COALESCE(p.mode::text, 'MY_COUNTRY')", "u.id")} AS mode,
      COALESCE(p.enabled, TRUE) AS discovery_enabled,
      COALESCE(p.version, 1)::bigint AS policy_version,
      COALESCE(p.verified_only, TRUE) AS verified_only,
      COALESCE(p.allow_businesses, TRUE) AS allow_businesses,
      COALESCE(p.allow_events, TRUE) AS allow_events,
      COALESCE(p.allow_communities, TRUE) AS allow_communities,
      u.state_region,
      COALESCE((SELECT array_agg(cl.country_code) FROM country_links cl WHERE cl.user_id = u.id), ARRAY[]::text[]) AS selected_countries,
      COALESCE((SELECT array_agg(rl.region_code) FROM regional_links rl WHERE rl.user_id = u.id), ARRAY[]::text[]) AS selected_regions
    FROM users u
    LEFT JOIN country_discovery_preferences p ON p.user_id = u.id
    JOIN countries viewer_country ON viewer_country.code=u.verified_country_code AND viewer_country.enabled=TRUE
    JOIN countrylinqa_country_status viewer_status ON viewer_status.country_code=viewer_country.code AND viewer_status.discovery_enabled=TRUE
    WHERE u.id = $${viewerIdParamIndex} AND u.status='ACTIVE'
  )`;
}

export function authorScopePredicate(authorAlias = "author"): string {
  const inbound = entitledReachSql(`COALESCE((SELECT ap.inbound_reach::text FROM country_discovery_preferences ap WHERE ap.user_id=${authorAlias}.id), 'MY_COUNTRY')`, `${authorAlias}.id`);
  return `(
    vs.discovery_enabled = TRUE
    AND vs.country_verification_state = 'VERIFIED'
    AND EXISTS (SELECT 1 FROM countries author_country
      JOIN countrylinqa_country_status author_status ON author_status.country_code=author_country.code AND author_status.discovery_enabled=TRUE
      WHERE author_country.code=${authorAlias}.verified_country_code AND author_country.enabled=TRUE)
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
      ${inbound} = 'GLOBAL'
      OR (${inbound} = 'MY_COUNTRY'
          AND vs.verified_country_code = ${authorAlias}.verified_country_code)
      OR (${inbound} = 'SELECTED_COUNTRIES'
          AND EXISTS (SELECT 1 FROM country_inbound_links cil WHERE cil.user_id=${authorAlias}.id AND cil.country_code=vs.verified_country_code))
      OR (${inbound} = 'REGION'
          AND EXISTS (
            SELECT 1 FROM countries viewer_country
            JOIN regional_inbound_links ril ON ril.region_code=viewer_country.region_code
            WHERE viewer_country.code=vs.verified_country_code AND ril.user_id=${authorAlias}.id
          ))
      OR (${inbound} = 'CONTACTS_ONLY'
          AND EXISTS (
            SELECT 1 FROM contact_requests cr
            WHERE cr.status='ACCEPTED'
              AND ((cr.sender_user_id=vs.viewer_id AND cr.recipient_user_id=${authorAlias}.id)
                OR (cr.recipient_user_id=vs.viewer_id AND cr.sender_user_id=${authorAlias}.id))
          ))
    )
  )`;
}

/** Content location is filtered in addition to its owner's inbound privacy. */
export function contentScopePredicate(country: string, region: string): string {
  return `(vs.discovery_enabled = TRUE AND vs.country_verification_state = 'VERIFIED' AND (
    vs.mode = 'GLOBAL'
    OR (vs.mode = 'MY_COUNTRY' AND ${country} = vs.verified_country_code)
    OR (vs.mode = 'SELECTED_COUNTRIES' AND ${country} = ANY(vs.selected_countries))
    OR (vs.mode = 'REGION' AND ${region} = ANY(vs.selected_regions))
  ))`;
}

export function safetyPredicate(authorAlias = "author", viewerParamIndex = 1): string {
  return `${authorAlias}.status = 'ACTIVE'
    AND ${authorAlias}.country_verification_state <> 'RESTRICTED'
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = $${viewerParamIndex} AND ub.blocked_id = ${authorAlias}.id)
         OR (ub.blocker_id = ${authorAlias}.id AND ub.blocked_id = $${viewerParamIndex})
    )
    AND NOT EXISTS (
      SELECT 1 FROM blocked_users bu
      WHERE (bu.blocker_user_id = $${viewerParamIndex} AND bu.blocked_user_id = ${authorAlias}.id)
         OR (bu.blocker_user_id = ${authorAlias}.id AND bu.blocked_user_id = $${viewerParamIndex})
    )`;
}

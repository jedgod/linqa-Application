import { z } from "zod";
import type { Database } from "../../../db/pool.js";

const token = z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N} ._+#&/-]+$/u).transform((value) => value.toLowerCase());

export const discoveryFeaturesSchema = z.object({
  languages: z.array(token).max(10).default([]),
  interests: z.array(token).max(20).default([]),
  professionCode: token.nullable().default(null),
  discoverable: z.boolean().default(true)
}).strict();

export type DiscoveryFeatures = z.infer<typeof discoveryFeaturesSchema>;

export async function getDiscoveryFeatures(db: Database, userId: string): Promise<DiscoveryFeatures & { featureVersion: number }> {
  const result = await db.query(
    `SELECT languages, interests, profession_code AS "professionCode", discoverable, feature_version::text AS "featureVersion"
     FROM countrylinqa_user_discovery_features WHERE user_id = $1`, [userId]
  );
  const row = result.rows[0];
  return {
    languages: row?.languages ?? [], interests: row?.interests ?? [],
    professionCode: row?.professionCode ?? null, discoverable: row?.discoverable ?? true,
    featureVersion: Number(row?.featureVersion ?? 0)
  };
}

/**
 * Features only influence ranking and let a person opt out of being discovered.
 * Bumping `feature_version` retires cached ranked pools built from older values.
 */
export async function saveDiscoveryFeatures(db: Database, userId: string, input: DiscoveryFeatures) {
  const unique = (values: string[]) => [...new Set(values)];
  const result = await db.query(
    `INSERT INTO countrylinqa_user_discovery_features (user_id, languages, interests, profession_code, discoverable)
     VALUES ($1, $2::text[], $3::text[], $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET languages = EXCLUDED.languages, interests = EXCLUDED.interests,
       profession_code = EXCLUDED.profession_code, discoverable = EXCLUDED.discoverable,
       feature_version = countrylinqa_user_discovery_features.feature_version + 1, updated_at = now()
     RETURNING languages, interests, profession_code AS "professionCode", discoverable, feature_version::text AS "featureVersion"`,
    [userId, unique(input.languages), unique(input.interests), input.professionCode, input.discoverable]
  );
  const row = result.rows[0];
  return { ...row, featureVersion: Number(row.featureVersion) };
}

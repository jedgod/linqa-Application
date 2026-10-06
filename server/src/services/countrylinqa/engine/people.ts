import crypto from "node:crypto";
import type { Database } from "../../../db/pool.js";
import type { Cache } from "../final/cache.js";
import { authorScopePredicate, safetyPredicate, viewerScopeCte } from "../feed-scope.js";
import { countryLinqaCandidatePoolLimit } from "../candidate-window.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { canonicalFilters, validateFilters, type DiscoveryFilters } from "./filters.js";
import { diversify, rankAll, type RankedCandidate, type ViewerFeatures } from "./ranker.js";

export const MAX_PAGE = 50;
/** Ranked pools are reused across pages so paging is consistent and cheap. */
export const POOL_TTL_SECONDS = 45;

export type PersonResult = {
  id: string;
  displayName: string;
  avatarObjectKey: string | null;
  verifiedCountryCode: string | null;
  verified: boolean;
  rankingScore: number;
  reasons: string[];
  connectionStatus: string | null;
};

type PoolEntry = RankedCandidate & {
  displayName: string;
  avatarObjectKey: string | null;
  verifiedCountryCode: string | null;
  connectionStatus: string | null;
};

function toPerson(row: any, score: number, reasons: string[]): PersonResult {
  return {
    id: row.user_id, displayName: row.display_name, avatarObjectKey: row.avatar_object_key ?? null,
    verifiedCountryCode: row.shown_country ?? null, verified: Boolean(row.verified),
    rankingScore: score, reasons, connectionStatus: row.connection_status ?? null
  };
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Eligible-candidate SQL. Geographic policy and safety are applied here, before any ranking. */
function candidateSql(filters: DiscoveryFilters, extra?: { ids: string[] }) {
  const params: unknown[] = [];
  const where: string[] = [];
  const push = (value: unknown) => { params.push(value); return `$${params.length + 1}`; };

  if (filters.query) where.push(`profile.display_name ILIKE ${push(`%${escapeLike(filters.query)}%`)} ESCAPE '\\'`);
  if (filters.countries?.length) where.push(`author.verified_country_code = ANY(${push(filters.countries)}::text[])`);
  if (filters.region) where.push(`EXISTS (SELECT 1 FROM countries rc WHERE rc.code = author.verified_country_code AND rc.region_code = ${push(filters.region)})`);
  // A city is searchable only for people who chose to show it, so this can not reveal a hidden city.
  if (filters.city) where.push(`(COALESCE(ap.show_country, TRUE) AND author.show_city AND author.location_precision = 'CITY' AND author.city ILIKE ${push(`%${escapeLike(filters.city)}%`)} ESCAPE '\\')`);
  if (filters.languages?.length) where.push(`f.languages && ${push(filters.languages)}::text[]`);
  if (filters.interests?.length) where.push(`f.interests && ${push(filters.interests)}::text[]`);
  if (filters.profession) where.push(`f.profession_code = ${push(filters.profession)}`);
  if (filters.verifiedOnly) where.push(`author.country_verification_state = 'VERIFIED'`);
  if (extra) where.push(`author.id = ANY(${push(extra.ids)}::uuid[])`);

  const sql = `WITH ${viewerScopeCte(1)},
    my_contacts AS (
      SELECT CASE WHEN sender_user_id = $1 THEN recipient_user_id ELSE sender_user_id END AS uid
      FROM contact_requests WHERE status = 'ACCEPTED' AND (sender_user_id = $1 OR recipient_user_id = $1)
    )
    SELECT author.id AS user_id, profile.display_name, profile.avatar_object_key,
      CASE WHEN COALESCE(ap.show_country, TRUE) THEN author.verified_country_code ELSE NULL END AS shown_country,
      (author.country_verification_state = 'VERIFIED') AS verified,
      COALESCE(f.languages, '{}') AS languages, COALESCE(f.interests, '{}') AS interests, f.profession_code,
      (SELECT count(*)::int FROM contact_requests cr WHERE cr.status = 'ACCEPTED' AND (
         (cr.sender_user_id = author.id AND cr.recipient_user_id IN (SELECT uid FROM my_contacts))
         OR (cr.recipient_user_id = author.id AND cr.sender_user_id IN (SELECT uid FROM my_contacts)))) AS mutual_connections,
      (CASE WHEN profile.avatar_object_key IS NOT NULL THEN 0.35 ELSE 0 END
       + CASE WHEN COALESCE(profile.bio, '') <> '' THEN 0.25 ELSE 0 END
       + CASE WHEN author.country_verification_state = 'VERIFIED' THEN 0.4 ELSE 0 END) AS profile_quality,
      (CASE WHEN author.country_verification_state = 'VERIFIED' THEN 1.0 ELSE 0.5 END) AS safety_quality,
      GREATEST(0, 1 - EXTRACT(EPOCH FROM (now() - COALESCE(f.updated_at, author.created_at))) / 86400 / 365) AS freshness,
      connection.status AS connection_status
    FROM users author
    JOIN user_profiles profile ON profile.user_id = author.id
    LEFT JOIN country_discovery_preferences ap ON ap.user_id = author.id
    LEFT JOIN countrylinqa_user_discovery_features f ON f.user_id = author.id
    CROSS JOIN viewer_scope vs
    LEFT JOIN LATERAL (
      SELECT cr.status FROM contact_requests cr
      WHERE ((cr.sender_user_id = $1 AND cr.recipient_user_id = author.id) OR (cr.recipient_user_id = $1 AND cr.sender_user_id = author.id))
        AND (cr.status = 'ACCEPTED' OR (cr.status = 'PENDING' AND cr.expires_at > now()))
      ORDER BY (cr.status = 'ACCEPTED') DESC, cr.created_at DESC LIMIT 1
    ) connection ON TRUE
    WHERE author.status = 'ACTIVE' AND author.id <> $1
      AND COALESCE(f.discoverable, TRUE) = TRUE
      AND ${safetyPredicate("author", 1)} AND ${authorScopePredicate("author")}
      ${where.length ? `AND ${where.join(" AND ")}` : ""}`;
  return { sql, params };
}

export class AdvancedDiscoveryService {
  constructor(
    private readonly db: Database,
    private readonly cache: Cache,
    private readonly cursorSecret: Buffer,
    private readonly onMetric: (event: { surface: string; latencyMs: number; cache: "hit" | "miss"; results: number }) => void = () => {}
  ) {}

  private async viewerState(userId: string) {
    const scope = await this.db.query(
      `WITH ${viewerScopeCte(1)} SELECT policy_version::text AS "policyVersion" FROM viewer_scope`, [userId]
    );
    if (!scope.rowCount) return null;
    const features = await this.db.query(
      `SELECT COALESCE(languages, '{}') AS languages, COALESCE(interests, '{}') AS interests,
              profession_code AS "professionCode", feature_version::text AS "featureVersion"
       FROM countrylinqa_user_discovery_features WHERE user_id = $1`, [userId]
    );
    const f = features.rows[0];
    return {
      policyVersion: Number(scope.rows[0].policyVersion),
      viewer: { languages: f?.languages ?? [], interests: f?.interests ?? [], professionCode: f?.professionCode ?? null } as ViewerFeatures,
      featureVersion: Number(f?.featureVersion ?? 0)
    };
  }

  /** Ranked, diversified eligible candidates for a viewer. Cached under policy + feature versions. */
  async rankedPool(userId: string, filters: DiscoveryFilters, state: NonNullable<Awaited<ReturnType<AdvancedDiscoveryService["viewerState"]>>>) {
    const key = `clq:people:${userId}:p${state.policyVersion}:f${state.featureVersion}:${filterHash(filters)}`;
    const hit = await this.cache.get<PoolEntry[]>(key);
    if (hit) return { pool: hit, cache: "hit" as const };

    const { sql, params } = candidateSql(filters);
    const result = await this.db.query(`${sql} ORDER BY author.id LIMIT ${countryLinqaCandidatePoolLimit()}`, [userId, ...params]);
    const byId = new Map<string, Omit<PoolEntry, keyof RankedCandidate>>();
    const ranked = rankAll(state.viewer, result.rows.map((r: any) => {
      byId.set(r.user_id, { displayName: r.display_name, avatarObjectKey: r.avatar_object_key ?? null, verifiedCountryCode: r.shown_country ?? null, connectionStatus: r.connection_status ?? null });
      return {
        userId: r.user_id, languages: r.languages, interests: r.interests, professionCode: r.profession_code ?? null,
        verified: Boolean(r.verified), mutualConnections: Number(r.mutual_connections), profileQuality: Number(r.profile_quality),
        safetyQuality: Number(r.safety_quality), freshness: Number(r.freshness)
      };
    }));
    const pool = diversify(ranked, MAX_PAGE).map((c) => ({ ...c, ...byId.get(c.userId)! }));
    await this.cache.set(key, pool, POOL_TTL_SECONDS);
    return { pool, cache: "miss" as const };
  }

  /** Re-checks ids against live policy and blocks, so a cached pool or snapshot can never outlive a block or policy change. */
  private async eligibleRows(userId: string, filters: DiscoveryFilters, ids: string[]): Promise<Map<string, any>> {
    if (!ids.length) return new Map();
    const { sql, params } = candidateSql(filters, { ids });
    const result = await this.db.query(sql, [userId, ...params]);
    return new Map(result.rows.map((r: any) => [r.user_id as string, r]));
  }

  /** Display-ready people for ids ranked elsewhere (recommendation snapshots), dropping anyone no longer eligible. */
  async hydrate(userId: string, ranked: Array<{ id: string; score: number; reasons: string[] }>): Promise<PersonResult[]> {
    const rows = await this.eligibleRows(userId, {}, ranked.map((r) => r.id));
    return ranked.flatMap((r) => {
      const row = rows.get(r.id);
      return row ? [toPerson(row, r.score, r.reasons)] : [];
    });
  }

  async people(userId: string, rawFilters: unknown, options: { limit: number; cursor?: string | undefined }) {
    const started = Date.now();
    const filters = validateFilters(rawFilters);
    const limit = Math.min(Math.max(Math.trunc(options.limit) || 30, 1), MAX_PAGE);
    const state = await this.viewerState(userId);
    if (!state) return { items: [] as PersonResult[], nextCursor: null as string | null, meta: { policyVersion: null as number | null } };

    const fh = filterHash(filters);
    const offset = options.cursor ? decodeCursor(this.cursorSecret, options.cursor, { pv: state.policyVersion, fh }).o : 0;
    const { pool, cache } = await this.rankedPool(userId, filters, state);
    const slice = pool.slice(offset, offset + limit);
    const live = await this.eligibleRows(userId, filters, slice.map((c) => c.userId));
    const items: PersonResult[] = slice.filter((c) => live.has(c.userId)).map((c) => toPerson(live.get(c.userId), c.score, c.reasons));

    const nextOffset = offset + slice.length;
    const nextCursor = nextOffset < pool.length
      ? encodeCursor(this.cursorSecret, { o: nextOffset, pv: state.policyVersion, fh, iat: Date.now() })
      : null;

    if (items.length) await this.recordImpressions(userId, items, offset, state.policyVersion);
    this.onMetric({ surface: "PEOPLE", latencyMs: Date.now() - started, cache, results: items.length });
    return { items, nextCursor, meta: { policyVersion: state.policyVersion } };
  }

  private async recordImpressions(userId: string, items: PersonResult[], offset: number, policyVersion: number) {
    try {
      await this.db.query(
        `INSERT INTO countrylinqa_discovery_impressions (viewer_user_id, candidate_user_id, surface, rank_position, reason_codes, policy_version)
         SELECT $1, t.candidate, 'PEOPLE', t.pos, COALESCE(string_to_array(NULLIF(t.reasons_text, ''), ','), '{}'), $5::bigint
         FROM unnest($2::uuid[], $3::int[], $4::text[]) AS t(candidate, pos, reasons_text)`,
        [userId, items.map((i) => i.id), items.map((_, i) => offset + i + 1), items.map((i) => i.reasons.join(",")), policyVersion]
      );
    } catch {
      // Impressions feed analytics only; a logging failure must never fail discovery.
    }
  }
}

export function filterHash(filters: DiscoveryFilters): string {
  return crypto.createHash("sha256").update(canonicalFilters(filters)).digest("hex").slice(0, 24);
}

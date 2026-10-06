import type { Cache } from "../final/cache.js";
import type { Database } from "../../../db/pool.js";

export type DiscoverySurface = "PEOPLE" | "RECOMMENDATIONS" | "SAVED_SEARCH_ALERTS" | "ADVANCED_RANKING";

const FLAG_FOR_SURFACE: Record<DiscoverySurface, string> = {
  PEOPLE: "countrylinqa.people",
  RECOMMENDATIONS: "countrylinqa.recommendations",
  SAVED_SEARCH_ALERTS: "countrylinqa.saved_search_alerts",
  ADVANCED_RANKING: "countrylinqa.advanced_ranking"
};

const CACHE_SECONDS = 60;

type FlagState = { enabled: boolean; rolloutPercent: number };

/** Stable 0-99 bucket for a user, so a given user is consistently in or out of a percentage rollout. */
export function rolloutBucket(userId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) hash = Math.imul(hash ^ userId.charCodeAt(i), 16777619);
  return (hash >>> 0) % 100;
}

/**
 * Server-authoritative kill switches and percentage rollout.
 *
 * Flags live in countrylinqa_feature_flags and are cached for 60s, so turning
 * one off takes effect within a minute without a deploy. `countrylinqa.enabled`
 * stops every surface. A flag's `config.rolloutPercent` (default 100) limits it
 * to a deterministic cohort of users. A missing flag row counts as OFF: the
 * safe default for a kill switch.
 */
export class DiscoveryControls {
  constructor(private readonly db: Database, private readonly cache: Cache) {}

  private async flag(key: string): Promise<FlagState> {
    const cacheKey = `countrylinqa:flag2:${key}`;
    const cached = await this.cache.get<FlagState>(cacheKey);
    if (cached) return cached;
    const result = await this.db.query(`SELECT enabled, config FROM countrylinqa_feature_flags WHERE key = $1`, [key]);
    const row = result.rows[0];
    const percent = Number(row?.config?.rolloutPercent ?? 100);
    const state: FlagState = { enabled: Boolean(row?.enabled), rolloutPercent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 100 };
    await this.cache.set(cacheKey, state, CACHE_SECONDS);
    return state;
  }

  /** `userId` applies the percentage rollout; omit it for surface-wide (non-user) checks. */
  async available(surface: DiscoverySurface, userId?: string): Promise<boolean> {
    for (const key of ["countrylinqa.enabled", FLAG_FOR_SURFACE[surface]]) {
      const state = await this.flag(key);
      if (!state.enabled) return false;
      if (userId !== undefined && rolloutBucket(userId) >= state.rolloutPercent) return false;
    }
    return true;
  }

  async assertAvailable(surface: DiscoverySurface, userId?: string): Promise<void> {
    if (!(await this.available(surface, userId))) {
      throw Object.assign(new Error("COUNTRYLINQA_TEMPORARILY_UNAVAILABLE"), {
        status: 503,
        code: "COUNTRYLINQA_TEMPORARILY_UNAVAILABLE"
      });
    }
  }
}

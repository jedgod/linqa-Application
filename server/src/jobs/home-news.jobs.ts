import type { Database } from "../db/pool.js";
import { homeProductionConfig } from "../config/home-production.config.js";
import type { HomeRepository } from "../home/home.repository.js";
import type { DurableHomeCache } from "../home/durable-cache.service.js";
import type { HomeTelemetryService } from "../home/home-telemetry.service.js";
import type { NewsRouterService } from "../home/news-router.service.js";

/**
 * Countries worth pre-warming: the jurisdictions Linqa actually has verified
 * users in. Pre-warming every country in the table would burn the provider
 * budget on jurisdictions with no readers.
 */
export async function activeJurisdictionCountries(db: Database, limit: number): Promise<string[]> {
  const result = await db.query(
    `SELECT verified_country_code AS code, count(*)::int AS users
     FROM users
     WHERE status='ACTIVE' AND verified_country_code IS NOT NULL
     GROUP BY verified_country_code
     ORDER BY count(*) DESC, verified_country_code ASC
     LIMIT $1`,
    [Math.max(1, limit)]
  );
  return (result.rows as Array<{ code: string }>).map((row) => row.code.trim().toUpperCase());
}

export interface RefreshGlobalNewsResult {
  global: number;
  perCountry: Record<string, number>;
  failures: string[];
}

/**
 * Keeps the news cache warm so a user request is almost always a fresh cache
 * hit rather than a synchronous fan-out to GDELT. The cache TTL (5 min fresh /
 * 30 min stale) is sized around this job's interval.
 */
export async function runRefreshGlobalNewsJob(deps: {
  db: Database;
  newsRouter: NewsRouterService;
  telemetry: HomeTelemetryService;
  maxCountries?: number;
}): Promise<RefreshGlobalNewsResult> {
  const result: RefreshGlobalNewsResult = { global: 0, perCountry: {}, failures: [] };

  try {
    const global = await deps.newsRouter.fetch({ limit: homeProductionConfig.news.maxArticlesPerProvider });
    result.global = global.articles.length;
    deps.telemetry.newsRefreshRun("GLOBAL", global.articles.length);
  } catch (error) {
    result.failures.push(`GLOBAL:${error instanceof Error ? error.message : "UNKNOWN"}`);
  }

  const countries = await activeJurisdictionCountries(
    deps.db,
    deps.maxCountries ?? homeProductionConfig.jobs.maxCountriesPerRefresh
  );

  // Sequential: the point of this job is to be gentle on the upstream, and a
  // parallel fan-out across 25 countries is how a provider starts rate
  // limiting (which the circuit breaker would then read as an outage).
  for (const countryCode of countries) {
    try {
      const country = await deps.newsRouter.fetch({ countryCode, limit: 30 });
      result.perCountry[countryCode] = country.articles.length;
      deps.telemetry.newsRefreshRun("COUNTRY", country.articles.length);
    } catch (error) {
      result.failures.push(`${countryCode}:${error instanceof Error ? error.message : "UNKNOWN"}`);
    }
  }

  return result;
}

export interface HomeHousekeepingResult {
  breakingDemoted: number;
  articlesExpired: number;
  cacheEntriesPruned: number;
  snapshotsPruned: number;
}

/**
 * Closes breaking windows and clears out what has aged past usefulness.
 *
 * The closure pack called this "expire breaking news"; see
 * `HomeRepository.demoteExpiredBreaking` for why a closed breaking window
 * demotes the story rather than retiring it.
 */
export async function runHomeHousekeepingJob(deps: {
  repository: HomeRepository;
  cache: DurableHomeCache;
  maxArticleAgeDays?: number;
}): Promise<HomeHousekeepingResult> {
  const [breakingDemoted, articlesExpired, cacheEntriesPruned, snapshotsPruned] = await Promise.all([
    deps.repository.demoteExpiredBreaking(),
    deps.repository.expireStaleArticles(deps.maxArticleAgeDays ?? 14),
    deps.cache.pruneExpired(),
    deps.repository.pruneSnapshots()
  ]);
  return { breakingDemoted, articlesExpired, cacheEntriesPruned, snapshotsPruned };
}

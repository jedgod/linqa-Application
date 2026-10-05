import type { Database } from "../db/pool.js";
import { homeProductionConfig } from "../config/home-production.config.js";
import { DurableHomeCache } from "./durable-cache.service.js";
import { HomeRepository } from "./home.repository.js";
import { HomeTelemetryService } from "./home-telemetry.service.js";
import type { HomeNewsItem, NewsQuery, NewsState } from "./home.types.js";
import type { NewsProvider } from "./news-provider.js";
import { NewsValidationService } from "./news-validation.service.js";

export interface NewsFetchResult {
  articles: HomeNewsItem[];
  state: NewsState;
}

// Floors an article must clear to reach a client. Both are intentionally
// stated here rather than in config: they are a product-safety contract that
// the release gate's tests pin, not an operational knob.
const MIN_VALIDATION_SCORE = 0.65;
const MIN_TRUST_SCORE = 0.3;

export class NewsRouterService {
  /**
   * One in-flight upstream refresh per cache key. Without this, every request
   * that arrives while the cache is stale starts its own fan-out across every
   * provider — a self-inflicted thundering herd against GDELT precisely when
   * the feed is already struggling.
   */
  private readonly inFlight = new Map<string, Promise<NewsFetchResult>>();

  constructor(
    private readonly db: Database,
    private readonly providers: NewsProvider[],
    private readonly validator: NewsValidationService,
    private readonly cache: DurableHomeCache,
    private readonly telemetry: HomeTelemetryService,
    private readonly homeRepository: HomeRepository
  ) {}

  configuredProviders(): string[] {
    return this.providers.filter((provider) => provider.isConfigured()).map((provider) => provider.name);
  }

  private cacheKey(query: NewsQuery): string {
    return [
      "news",
      query.countryCode ?? "GLOBAL",
      [...(query.categories ?? [])].sort().join(",") || "ALL",
      String(query.limit),
      query.breakingOnly ? "BREAKING" : "NORMAL"
    ].join(":");
  }

  async fetch(query: NewsQuery): Promise<NewsFetchResult> {
    const key = this.cacheKey(query);
    const cached = await this.cache.get<HomeNewsItem[]>(key);
    if (cached && !cached.stale) {
      this.telemetry.cacheHit(false);
      return { articles: cached.value, state: "LIVE" };
    }

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const refresh = this.refresh(key, query, cached?.value)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, refresh);
    return refresh;
  }

  private async refresh(
    key: string,
    query: NewsQuery,
    staleArticles: HomeNewsItem[] | undefined
  ): Promise<NewsFetchResult> {
    const accepted = new Map<string, HomeNewsItem>();
    const providers = [...this.providers]
      .filter((provider) => provider.isConfigured())
      .sort((a, b) => b.priority - a.priority);

    for (const provider of providers) {
      if (await this.circuitIsOpen(provider.name)) continue;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), homeProductionConfig.news.requestTimeoutMs);
      timeout.unref?.();
      const started = Date.now();

      try {
        this.telemetry.newsRequest(provider.name);
        const raw = await provider.fetch(query, controller.signal);
        this.telemetry.newsLatency(provider.name, Date.now() - started);

        for (const article of raw.slice(0, homeProductionConfig.news.maxArticlesPerProvider)) {
          try {
            const validated = await this.validator.validate(article);
            if (validated.validationScore < MIN_VALIDATION_SCORE || validated.trustScore < MIN_TRUST_SCORE) {
              this.telemetry.rejected("LOW_SCORE");
              continue;
            }
            const seen = accepted.get(validated.contentFingerprint);
            // Higher-priority providers run first, so the first copy of a
            // story wins unless a later one is objectively better attributed.
            if (!seen || seen.validationScore < validated.validationScore) {
              accepted.set(validated.contentFingerprint, validated);
            }
          } catch (error) {
            this.telemetry.rejected(error instanceof Error ? error.message : "VALIDATION_ERROR");
          }
        }

        await this.recordProviderSuccess(provider.name, Date.now() - started);
        // The unfiltered global feed must combine first-party publisher feeds
        // with the broader index: sources without a working RSS endpoint (for
        // example CNN and Gartner) are otherwise starved by the RSS lane.
        if (accepted.size >= query.limit && query.categories?.length) break;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "UNKNOWN_PROVIDER_FAILURE";
        this.telemetry.newsFailure(provider.name, reason);
        await this.recordProviderFailure(provider.name);
      } finally {
        clearTimeout(timeout);
      }
    }

    const articles = [...accepted.values()]
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, query.limit);

    if (articles.length) {
      // Sequential on purpose: a 40-article batch of parallel upserts can
      // occupy the entire pg pool (max 20) and starve the request that is
      // waiting on this very refresh.
      for (const article of articles) {
        try {
          await this.homeRepository.saveArticle(article);
        } catch (error) {
          // Persistence is for the durable store and the /news list; a failed
          // upsert must not lose an otherwise good feed.
          this.telemetry.rejected(error instanceof Error ? `PERSIST_${error.message}` : "PERSIST_FAILED");
        }
      }
      await this.cache.set(
        key,
        articles,
        "MULTI_PROVIDER_ROUTER",
        homeProductionConfig.news.cacheFreshSeconds,
        homeProductionConfig.news.cacheStaleSeconds
      );
      return { articles, state: "LIVE" };
    }

    if (staleArticles?.length) {
      this.telemetry.cacheHit(true);
      return { articles: staleArticles, state: "STALE" };
    }

    // No provider, no cache: say so. Home renders an honest "unavailable"
    // state rather than inventing a headline.
    return { articles: [], state: "UNAVAILABLE" };
  }

  private async circuitIsOpen(provider: string): Promise<boolean> {
    const health = await this.providerHealth(provider);
    if (!health) return false;
    if (health.state === "DISABLED") return true;
    return (
      health.state === "OPEN_CIRCUIT" &&
      Boolean(health.circuit_open_until) &&
      new Date(health.circuit_open_until as string).getTime() > Date.now()
    );
  }

  private async providerHealth(provider: string): Promise<Record<string, unknown> | null> {
    const result = await this.db.query(
      `SELECT * FROM home_news_provider_health WHERE provider_name=$1`,
      [provider]
    );
    return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  private async recordProviderSuccess(provider: string, latencyMs: number): Promise<void> {
    await this.db.query(
      `INSERT INTO home_news_provider_health
         (provider_name,state,consecutive_failures,last_success_at,moving_latency_ms,success_rate)
       VALUES ($1,'HEALTHY',0,now(),$2,1)
       ON CONFLICT (provider_name) DO UPDATE SET
         state='HEALTHY',
         consecutive_failures=0,
         last_success_at=now(),
         circuit_open_until=NULL,
         moving_latency_ms=COALESCE(home_news_provider_health.moving_latency_ms*0.8,0)+($2*0.2),
         success_rate=LEAST(1,home_news_provider_health.success_rate*0.95+0.05),
         updated_at=now()`,
      [provider, latencyMs]
    );
  }

  private async recordProviderFailure(provider: string): Promise<void> {
    await this.db.query(
      `INSERT INTO home_news_provider_health
         (provider_name,state,consecutive_failures,last_failure_at,success_rate)
       VALUES ($1,'DEGRADED',1,now(),0.8)
       ON CONFLICT (provider_name) DO UPDATE SET
         consecutive_failures=home_news_provider_health.consecutive_failures+1,
         last_failure_at=now(),
         success_rate=GREATEST(0,home_news_provider_health.success_rate*0.9),
         state=CASE WHEN home_news_provider_health.consecutive_failures+1 >= $2
           THEN 'OPEN_CIRCUIT' ELSE 'DEGRADED' END,
         circuit_open_until=CASE WHEN home_news_provider_health.consecutive_failures+1 >= $2
           THEN now()+make_interval(secs=>$3) ELSE home_news_provider_health.circuit_open_until END,
         updated_at=now()`,
      [provider, homeProductionConfig.news.providerFailureThreshold, homeProductionConfig.news.circuitOpenSeconds]
    );
  }
}

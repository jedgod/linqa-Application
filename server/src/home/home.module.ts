import type { Database } from "../db/pool.js";
import { DurableHomeCache } from "./durable-cache.service.js";
import { createHomeDependencies } from "./home-dependencies.js";
import { HomeFeedService, type HomeFeedDependencies } from "./home-feed.service.js";
import { HomeHealthService } from "./home-health.service.js";
import { HomeRepository } from "./home.repository.js";
import { SocketHomeRedisClient, type HomeRedisClient } from "./home-redis.client.js";
import { HomeTelemetryService, type HomeMetricsSink } from "./home-telemetry.service.js";
import { NewsRouterService } from "./news-router.service.js";
import { NewsValidationService } from "./news-validation.service.js";
import { HomePersonalizationService } from "./personalization.service.js";
import { ProviderHealthRepository } from "./provider-health.repository.js";
import { PublisherTrustRepository } from "./publisher-trust.repository.js";
import { PublisherTrustService } from "./publisher-trust.service.js";
import type { NewsProvider } from "./news-provider.js";
import { GdeltNewsProvider } from "./providers/gdelt.provider.js";
import { PublisherRssProvider } from "./providers/publisher-rss.provider.js";
import { ApprovedSecondaryProvider } from "./providers/secondary.provider.js";

export interface HomeModule {
  redis: HomeRedisClient | undefined;
  repository: HomeRepository;
  publisherRepository: PublisherTrustRepository;
  trust: PublisherTrustService;
  cache: DurableHomeCache;
  telemetry: HomeTelemetryService;
  router: NewsRouterService;
  personalization: HomePersonalizationService;
  providerHealth: ProviderHealthRepository;
  feed: HomeFeedService;
  health: HomeHealthService;
  providers: NewsProvider[];
  close(): Promise<void>;
}

export interface HomeModuleInput {
  db: Database;
  redisUrl?: string | undefined;
  metrics?: HomeMetricsSink | undefined;
  /** Overridable for tests and for callers that want to stub one section. */
  dependencies?: HomeFeedDependencies | undefined;
  providers?: NewsProvider[] | undefined;
  /** Reported by the caller when Redis could not be constructed at all. */
  onRedisError?: ((error: Error) => void) | undefined;
}

/**
 * Assembles the Home stack. Redis is optional at every level: a bad or absent
 * REDIS_URL degrades to the PostgreSQL cache tier instead of failing boot,
 * which is what keeps a Redis incident from becoming a Home outage.
 */
export function createHomeModule(input: HomeModuleInput): HomeModule {
  let redis: HomeRedisClient | undefined;
  if (input.redisUrl) {
    try {
      redis = new SocketHomeRedisClient(input.redisUrl);
    } catch (error) {
      redis = undefined;
      input.onRedisError?.(error instanceof Error ? error : new Error("REDIS_CLIENT_UNAVAILABLE"));
    }
  }

  const repository = new HomeRepository(input.db);
  const publisherRepository = new PublisherTrustRepository(input.db);
  const trust = new PublisherTrustService(publisherRepository);
  const cache = new DurableHomeCache(input.db, redis);
  const telemetry = new HomeTelemetryService(input.metrics);
  // Three independent lanes, highest priority first: the publishers' own RSS,
  // the GDELT index, then any contracted aggregation. Redundancy here is what
  // the release gate's provider check is asking about -- losing one upstream
  // must degrade the feed, not empty it.
  const providers = input.providers ?? [
    new PublisherRssProvider(),
    new GdeltNewsProvider(),
    new ApprovedSecondaryProvider()
  ];
  const router = new NewsRouterService(
    input.db,
    providers,
    new NewsValidationService(trust),
    cache,
    telemetry,
    repository
  );
  const personalization = new HomePersonalizationService(input.db);
  const providerHealth = new ProviderHealthRepository(input.db);
  const dependencies = input.dependencies ?? createHomeDependencies(input.db, repository);
  const feed = new HomeFeedService(repository, router, personalization, telemetry, dependencies);
  const health = new HomeHealthService(input.db, redis, providerHealth, router, cache);

  return {
    redis,
    repository,
    publisherRepository,
    trust,
    cache,
    telemetry,
    router,
    personalization,
    providerHealth,
    feed,
    health,
    providers,
    async close() {
      await redis?.close();
    }
  };
}

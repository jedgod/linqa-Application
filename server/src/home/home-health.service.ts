import type { Database } from "../db/pool.js";
import { DurableHomeCache } from "./durable-cache.service.js";
import type { HomeRedisClient } from "./home-redis.client.js";
import { NewsRouterService } from "./news-router.service.js";
import { ProviderHealthRepository, type ProviderHealthRow } from "./provider-health.repository.js";

export interface HomeReadiness {
  ready: boolean;
  checkedAt: string;
  checks: {
    postgres: { ok: boolean; error?: string };
    redis: { ok: boolean; optional?: boolean; degraded?: boolean; fallback: "POSTGRES"; error?: string };
    newsProviders: {
      ok: boolean;
      redundant: boolean;
      configured: string[];
      usable: string[];
      providers: ProviderHealthRow[];
    };
    publisherTrust: { ok: boolean; trustedPublishers: number; error?: string };
  };
}

export class HomeHealthService {
  constructor(
    private readonly db: Database,
    private readonly redis: HomeRedisClient | undefined,
    private readonly providerHealth: ProviderHealthRepository,
    private readonly newsRouter: NewsRouterService,
    private readonly cache: DurableHomeCache
  ) {}

  /**
   * Dependency readiness for `/health/home`.
   *
   * Redis is explicitly *not* part of the ready decision: PostgreSQL is the
   * authoritative cache tier, so a Redis outage is reported as degraded but
   * must not take Home out of the load balancer.
   */
  async readiness(): Promise<HomeReadiness> {
    const checks: HomeReadiness["checks"] = {
      postgres: { ok: false },
      redis: { ok: true, fallback: "POSTGRES" },
      newsProviders: { ok: false, redundant: false, configured: [], usable: [], providers: [] },
      publisherTrust: { ok: false, trustedPublishers: 0 }
    };

    try {
      await this.db.query("SELECT 1");
      checks.postgres = { ok: true };
    } catch (error) {
      checks.postgres = { ok: false, error: error instanceof Error ? error.message : "DB_FAILED" };
    }

    if (this.redis) {
      try {
        await this.redis.ping();
        checks.redis = { ok: true, fallback: "POSTGRES", degraded: this.cache.redisDegraded() };
      } catch (error) {
        checks.redis = {
          ok: false,
          degraded: true,
          fallback: "POSTGRES",
          error: error instanceof Error ? error.message : "REDIS_FAILED"
        };
      }
    } else {
      checks.redis = { ok: true, optional: true, fallback: "POSTGRES" };
    }

    const configured = this.newsRouter.configuredProviders();
    let providers: ProviderHealthRow[] = [];
    try {
      providers = await this.providerHealth.list();
    } catch {
      providers = [];
    }

    // A provider with no health row yet has never been called; it counts as
    // usable because the circuit breaker has nothing against it.
    const usable = configured.filter((name) => {
      const row = providers.find((provider) => provider.providerName === name);
      if (!row) return true;
      if (row.state === "DISABLED") return false;
      if (row.state !== "OPEN_CIRCUIT") return true;
      return !row.circuitOpenUntil || new Date(row.circuitOpenUntil).getTime() <= Date.now();
    });

    checks.newsProviders = {
      ok: usable.length >= 1,
      redundant: configured.length >= 2,
      configured,
      usable,
      providers
    };

    try {
      const result = await this.db.query(
        `SELECT count(*)::int AS total FROM home_news_publishers
         WHERE trust_status IN ('TRUSTED','LIMITED')`
      );
      const trustedPublishers = Number((result.rows[0] as { total?: number } | undefined)?.total ?? 0);
      // With an empty allowlist the validator rejects everything, so the feed
      // would be permanently UNAVAILABLE while every other check looked green.
      checks.publisherTrust = { ok: trustedPublishers > 0, trustedPublishers };
    } catch (error) {
      checks.publisherTrust = {
        ok: false,
        trustedPublishers: 0,
        error: error instanceof Error ? error.message : "PUBLISHER_TRUST_UNAVAILABLE"
      };
    }

    const ready = checks.postgres.ok && checks.newsProviders.ok && checks.publisherTrust.ok;
    return { ready, checkedAt: new Date().toISOString(), checks };
  }
}

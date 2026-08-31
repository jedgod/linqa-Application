import { describe, expect, it, vi } from "vitest";
import { HomeHealthService } from "../../home/home-health.service.js";
import type { Database } from "../../db/pool.js";
import type { DurableHomeCache } from "../../home/durable-cache.service.js";
import type { HomeRedisClient } from "../../home/home-redis.client.js";
import type { NewsRouterService } from "../../home/news-router.service.js";
import type { ProviderHealthRepository, ProviderHealthRow } from "../../home/provider-health.repository.js";

function providerRow(overrides: Partial<ProviderHealthRow> & { providerName: string }): ProviderHealthRow {
  return {
    state: "HEALTHY",
    consecutiveFailures: 0,
    lastSuccessAt: new Date().toISOString(),
    lastFailureAt: null,
    circuitOpenUntil: null,
    movingLatencyMs: 120,
    successRate: 1,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function build(options: {
  dbFails?: boolean;
  trustedPublishers?: number;
  redis?: "none" | "ok" | "failing";
  redisDegraded?: boolean;
  configured?: string[];
  providers?: ProviderHealthRow[];
  providerListFails?: boolean;
} = {}) {
  const db = {
    query: vi.fn(async (sql: string) => {
      if (options.dbFails) throw new Error("CONNECTION_REFUSED");
      if (sql.includes("home_news_publishers")) {
        return { rows: [{ total: options.trustedPublishers ?? 42 }], rowCount: 1 };
      }
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    })
  } as unknown as Database;

  const redis: HomeRedisClient | undefined = options.redis === "none" || options.redis === undefined
    ? undefined
    : ({
        get: vi.fn(),
        set: vi.fn(),
        ping: vi.fn(async () => {
          if (options.redis === "failing") throw new Error("REDIS_DOWN");
          return "PONG";
        }),
        close: vi.fn()
      } as unknown as HomeRedisClient);

  const providerHealth = {
    list: vi.fn(async () => {
      if (options.providerListFails) throw new Error("PROVIDER_HEALTH_UNAVAILABLE");
      return options.providers ?? [providerRow({ providerName: "GDELT_DOC_2" })];
    })
  } as unknown as ProviderHealthRepository;

  const newsRouter = {
    configuredProviders: vi.fn(() => options.configured ?? ["GDELT_DOC_2", "APPROVED_RSS"])
  } as unknown as NewsRouterService;

  const cache = { redisDegraded: vi.fn(() => options.redisDegraded === true) } as unknown as DurableHomeCache;

  return new HomeHealthService(db, redis, providerHealth, newsRouter, cache);
}

describe("home health readiness", () => {
  it("is ready with PostgreSQL, a usable provider and a seeded allowlist", async () => {
    const readiness = await build({ redis: "ok" }).readiness();

    expect(readiness.ready).toBe(true);
    expect(readiness.checks.postgres.ok).toBe(true);
    expect(readiness.checks.redis.ok).toBe(true);
    expect(readiness.checks.newsProviders.ok).toBe(true);
    expect(readiness.checks.newsProviders.redundant).toBe(true);
    expect(readiness.checks.publisherTrust.ok).toBe(true);
    expect(new Date(readiness.checkedAt).toString()).not.toBe("Invalid Date");
  });

  it("is not ready when PostgreSQL is unreachable", async () => {
    const readiness = await build({ dbFails: true }).readiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.postgres.ok).toBe(false);
    expect(readiness.checks.postgres.error).toContain("CONNECTION_REFUSED");
  });

  it("stays ready when Redis is down, because PostgreSQL is authoritative", async () => {
    const readiness = await build({ redis: "failing" }).readiness();

    expect(readiness.ready).toBe(true);
    expect(readiness.checks.redis.ok).toBe(false);
    expect(readiness.checks.redis.degraded).toBe(true);
    expect(readiness.checks.redis.fallback).toBe("POSTGRES");
  });

  it("marks Redis optional when none is configured", async () => {
    const readiness = await build({ redis: "none" }).readiness();

    expect(readiness.checks.redis).toMatchObject({ ok: true, optional: true, fallback: "POSTGRES" });
    expect(readiness.ready).toBe(true);
  });

  it("surfaces a silent Redis degradation reported by the cache", async () => {
    const readiness = await build({ redis: "ok", redisDegraded: true }).readiness();
    expect(readiness.checks.redis.degraded).toBe(true);
  });

  it("is not ready with no configured provider", async () => {
    const readiness = await build({ configured: [] }).readiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.newsProviders.ok).toBe(false);
    expect(readiness.checks.newsProviders.redundant).toBe(false);
  });

  it("reports non-redundant when only one provider is configured", async () => {
    const readiness = await build({ configured: ["GDELT_DOC_2"] }).readiness();

    // Still serving, but the release gate treats this as a blocker.
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.newsProviders.redundant).toBe(false);
  });

  it("is not ready when every provider's circuit is open", async () => {
    const readiness = await build({
      configured: ["GDELT_DOC_2"],
      providers: [providerRow({
        providerName: "GDELT_DOC_2",
        state: "OPEN_CIRCUIT",
        circuitOpenUntil: new Date(Date.now() + 60_000).toISOString()
      })]
    }).readiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.newsProviders.usable).toEqual([]);
  });

  it("counts a provider whose circuit window has elapsed as usable again", async () => {
    const readiness = await build({
      configured: ["GDELT_DOC_2"],
      providers: [providerRow({
        providerName: "GDELT_DOC_2",
        state: "OPEN_CIRCUIT",
        circuitOpenUntil: new Date(Date.now() - 60_000).toISOString()
      })]
    }).readiness();

    expect(readiness.checks.newsProviders.usable).toEqual(["GDELT_DOC_2"]);
  });

  it("counts an operator-DISABLED provider as unusable", async () => {
    const readiness = await build({
      configured: ["GDELT_DOC_2"],
      providers: [providerRow({ providerName: "GDELT_DOC_2", state: "DISABLED" })]
    }).readiness();

    expect(readiness.checks.newsProviders.usable).toEqual([]);
  });

  it("counts a never-called provider as usable", async () => {
    const readiness = await build({ configured: ["NEW_PROVIDER"], providers: [] }).readiness();
    expect(readiness.checks.newsProviders.usable).toEqual(["NEW_PROVIDER"]);
  });

  it("is not ready when the publisher allowlist is empty", async () => {
    // With no allowed publisher the validator rejects everything and the feed
    // is permanently UNAVAILABLE, so this must not read as healthy.
    const readiness = await build({ trustedPublishers: 0 }).readiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.checks.publisherTrust).toMatchObject({ ok: false, trustedPublishers: 0 });
  });

  it("does not fail readiness just because provider-health history is unreadable", async () => {
    const readiness = await build({ providerListFails: true }).readiness();

    expect(readiness.checks.newsProviders.providers).toEqual([]);
    expect(readiness.ready).toBe(true);
  });
});

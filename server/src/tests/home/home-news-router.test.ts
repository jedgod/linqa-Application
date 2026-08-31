import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewsRouterService } from "../../home/news-router.service.js";
import type { DurableHomeCache } from "../../home/durable-cache.service.js";
import type { HomeRepository } from "../../home/home.repository.js";
import type { NewsValidationService } from "../../home/news-validation.service.js";
import type { Database } from "../../db/pool.js";
import type { HomeNewsItem, NewsQuery, RawNewsArticle } from "../../home/home.types.js";
import type { NewsProvider } from "../../home/news-provider.js";
import { HomeTelemetryService } from "../../home/home-telemetry.service.js";

function newsItem(overrides: Partial<HomeNewsItem> = {}): HomeNewsItem {
  const title = overrides.title ?? "Wire service reports policy shift";
  return {
    providerName: "TEST",
    title,
    url: "https://reuters.com/story",
    canonicalUrl: "https://reuters.com/story",
    urlHash: `hash-${title}`,
    publisherDomain: "reuters.com",
    publisherName: "Reuters",
    publishedAt: new Date().toISOString(),
    category: "WORLD",
    providerScore: 0.7,
    validationScore: 0.9,
    trustScore: 1,
    contentFingerprint: `fingerprint-${title}`,
    publisherTrustStatus: "TRUSTED",
    attributionRequired: true,
    breakingEligible: true,
    ...overrides
  };
}

function rawArticle(overrides: Partial<RawNewsArticle> = {}): RawNewsArticle {
  return {
    providerName: "TEST",
    title: "Wire service reports policy shift",
    url: "https://reuters.com/story",
    publishedAt: new Date().toISOString(),
    providerScore: 0.7,
    ...overrides
  };
}

function stubProvider(
  name: string,
  priority: number,
  behaviour: (query: NewsQuery) => Promise<RawNewsArticle[]>,
  configured = true
): NewsProvider {
  return {
    name,
    priority,
    isConfigured: () => configured,
    fetch: vi.fn(async (query: NewsQuery) => behaviour(query))
  };
}

type Harness = {
  db: Database;
  cache: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  repository: { saveArticle: ReturnType<typeof vi.fn> };
  validator: { validate: ReturnType<typeof vi.fn> };
  telemetry: HomeTelemetryService;
  metrics: { increment: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn> };
  healthRows: Map<string, Record<string, unknown>>;
  queries: string[];
};

function harness(): Harness {
  const healthRows = new Map<string, Record<string, unknown>>();
  const queries: string[] = [];

  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push(sql);
      if (sql.includes("SELECT * FROM home_news_provider_health")) {
        const row = healthRows.get(String(params?.[0]));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    })
  } as unknown as Database;

  const metrics = { increment: vi.fn(), observe: vi.fn() };

  return {
    db,
    cache: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
    repository: { saveArticle: vi.fn(async () => undefined) },
    validator: { validate: vi.fn(async (raw: RawNewsArticle) => newsItem({ title: raw.title, providerName: raw.providerName })) },
    telemetry: new HomeTelemetryService(metrics),
    metrics,
    healthRows,
    queries
  };
}

function buildRouter(h: Harness, providers: NewsProvider[]): NewsRouterService {
  return new NewsRouterService(
    h.db,
    providers,
    h.validator as unknown as NewsValidationService,
    h.cache as unknown as DurableHomeCache,
    h.telemetry,
    h.repository as unknown as HomeRepository
  );
}

describe("home news router: provider failover", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("falls through to the secondary provider when the primary fails", async () => {
    const primary = stubProvider("PRIMARY", 100, async () => {
      throw new Error("PRIMARY_DOWN");
    });
    const secondary = stubProvider("SECONDARY", 50, async () => [
      rawArticle({ providerName: "SECONDARY", title: "Secondary provider story" })
    ]);

    const result = await buildRouter(h, [primary, secondary]).fetch({ limit: 10 });

    expect(result.state).toBe("LIVE");
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.providerName).toBe("SECONDARY");
    expect(h.metrics.increment).toHaveBeenCalledWith(
      "linqa_news_provider_failures_total",
      { provider: "PRIMARY", reason: "PRIMARY_DOWN" }
    );
  });

  it("tries providers in descending priority order", async () => {
    const order: string[] = [];
    const low = stubProvider("LOW", 10, async () => {
      order.push("LOW");
      return [];
    });
    const high = stubProvider("HIGH", 100, async () => {
      order.push("HIGH");
      return [];
    });

    await buildRouter(h, [low, high]).fetch({ limit: 10 });
    expect(order).toEqual(["HIGH", "LOW"]);
  });

  it("skips providers that report themselves unconfigured", async () => {
    const unconfigured = stubProvider("UNCONFIGURED", 100, async () => [rawArticle()], false);
    const configured = stubProvider("CONFIGURED", 50, async () => [
      rawArticle({ providerName: "CONFIGURED", title: "Configured provider story" })
    ]);

    const router = buildRouter(h, [unconfigured, configured]);
    expect(router.configuredProviders()).toEqual(["CONFIGURED"]);

    const result = await router.fetch({ limit: 10 });
    expect(unconfigured.fetch).not.toHaveBeenCalled();
    expect(result.articles[0]?.providerName).toBe("CONFIGURED");
  });

  it("stops calling further providers once the requested limit is met", async () => {
    const first = stubProvider("FIRST", 100, async () => [
      rawArticle({ title: "Story one" }),
      rawArticle({ title: "Story two" })
    ]);
    const second = stubProvider("SECOND", 50, async () => [rawArticle({ title: "Story three" })]);

    await buildRouter(h, [first, second]).fetch({ limit: 2 });
    expect(second.fetch).not.toHaveBeenCalled();
  });
});

describe("home news router: circuit breaker", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("does not call a provider whose circuit is open", async () => {
    h.healthRows.set("BROKEN", {
      provider_name: "BROKEN",
      state: "OPEN_CIRCUIT",
      circuit_open_until: new Date(Date.now() + 60_000).toISOString()
    });
    const broken = stubProvider("BROKEN", 100, async () => [rawArticle()]);
    const healthy = stubProvider("HEALTHY", 50, async () => [
      rawArticle({ providerName: "HEALTHY", title: "Healthy provider story" })
    ]);

    const result = await buildRouter(h, [broken, healthy]).fetch({ limit: 10 });

    expect(broken.fetch).not.toHaveBeenCalled();
    expect(result.articles[0]?.providerName).toBe("HEALTHY");
  });

  it("calls a provider again once its circuit window has elapsed", async () => {
    h.healthRows.set("RECOVERED", {
      provider_name: "RECOVERED",
      state: "OPEN_CIRCUIT",
      circuit_open_until: new Date(Date.now() - 1_000).toISOString()
    });
    const recovered = stubProvider("RECOVERED", 100, async () => [rawArticle()]);

    await buildRouter(h, [recovered]).fetch({ limit: 10 });
    expect(recovered.fetch).toHaveBeenCalled();
  });

  it("never calls a provider an operator has DISABLED, even with no open circuit", async () => {
    h.healthRows.set("OFF", { provider_name: "OFF", state: "DISABLED", circuit_open_until: null });
    const off = stubProvider("OFF", 100, async () => [rawArticle()]);

    const result = await buildRouter(h, [off]).fetch({ limit: 10 });
    expect(off.fetch).not.toHaveBeenCalled();
    expect(result.state).toBe("UNAVAILABLE");
  });

  it("records a failure so consecutive failures can trip the breaker", async () => {
    const failing = stubProvider("FAILING", 100, async () => {
      throw new Error("DOWN");
    });
    await buildRouter(h, [failing]).fetch({ limit: 10 });
    expect(h.queries.some((sql) => sql.includes("INSERT INTO home_news_provider_health") && sql.includes("OPEN_CIRCUIT")))
      .toBe(true);
  });

  it("records success and clears the open-circuit marker", async () => {
    const working = stubProvider("WORKING", 100, async () => [rawArticle()]);
    await buildRouter(h, [working]).fetch({ limit: 10 });
    expect(h.queries.some((sql) => sql.includes("circuit_open_until=NULL"))).toBe(true);
  });
});

describe("home news router: cache behaviour", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("serves a fresh cache hit without touching any provider", async () => {
    const cached = [newsItem({ title: "Cached fresh story" })];
    h.cache.get = vi.fn(async () => ({ value: cached, stale: false, source: "REDIS" }));
    const provider = stubProvider("PRIMARY", 100, async () => [rawArticle()]);

    const result = await buildRouter(h, [provider]).fetch({ limit: 10 });

    expect(provider.fetch).not.toHaveBeenCalled();
    expect(result.state).toBe("LIVE");
    expect(result.articles).toEqual(cached);
    expect(h.metrics.increment).toHaveBeenCalledWith("linqa_news_cache_hits_total");
  });

  it("serves stale cache marked STALE when every provider fails", async () => {
    const stale = [newsItem({ title: "Cached stale story" })];
    h.cache.get = vi.fn(async () => ({ value: stale, stale: true, source: "POSTGRES" }));
    const failing = stubProvider("FAIL", 100, async () => {
      throw new Error("DOWN");
    });

    const result = await buildRouter(h, [failing]).fetch({ limit: 10 });

    expect(result.state).toBe("STALE");
    expect(result.articles).toEqual(stale);
    expect(h.metrics.increment).toHaveBeenCalledWith("linqa_news_cache_stale_served_total");
  });

  it("reports UNAVAILABLE, and never a fabricated article, with no provider and no cache", async () => {
    const failing = stubProvider("FAIL", 100, async () => {
      throw new Error("DOWN");
    });

    const result = await buildRouter(h, [failing]).fetch({ limit: 10 });

    expect(result.state).toBe("UNAVAILABLE");
    expect(result.articles).toEqual([]);
  });

  it("reports UNAVAILABLE when there is no provider configured at all", async () => {
    const result = await buildRouter(h, []).fetch({ limit: 10 });
    expect(result).toEqual({ articles: [], state: "UNAVAILABLE" });
  });

  it("prefers a live refresh over a stale cache entry", async () => {
    h.cache.get = vi.fn(async () => ({
      value: [newsItem({ title: "Cached stale story" })],
      stale: true,
      source: "POSTGRES"
    }));
    const provider = stubProvider("PRIMARY", 100, async () => [rawArticle({ title: "Fresh live story" })]);

    const result = await buildRouter(h, [provider]).fetch({ limit: 10 });

    expect(result.state).toBe("LIVE");
    expect(result.articles[0]?.title).toBe("Fresh live story");
    expect(h.cache.set).toHaveBeenCalled();
  });

  it("keys the cache by country, category, limit and breaking flag", async () => {
    const provider = stubProvider("PRIMARY", 100, async () => [rawArticle()]);
    const router = buildRouter(h, [provider]);

    await router.fetch({ limit: 10 });
    await router.fetch({ limit: 10, countryCode: "GB" });
    await router.fetch({ limit: 10, countryCode: "GB", categories: ["POLITICS"] });
    await router.fetch({ limit: 10, countryCode: "GB", categories: ["POLITICS"], breakingOnly: true });

    const keys = h.cache.set.mock.calls.map((call) => call[0] as string);
    expect(new Set(keys).size).toBe(4);
    expect(keys).toContain("news:GLOBAL:ALL:10:NORMAL");
    expect(keys).toContain("news:GB:POLITICS:10:BREAKING");
  });

  it("produces the same cache key regardless of category ordering", async () => {
    const provider = stubProvider("PRIMARY", 100, async () => [rawArticle()]);
    const router = buildRouter(h, [provider]);

    await router.fetch({ limit: 10, categories: ["POLITICS", "HEALTH"] });
    await router.fetch({ limit: 10, categories: ["HEALTH", "POLITICS"] });

    const keys = h.cache.set.mock.calls.map((call) => call[0] as string);
    expect(keys[0]).toBe(keys[1]);
  });

  it("collapses concurrent refreshes of the same key into one upstream fan-out", async () => {
    let calls = 0;
    // Definite-assignment assertion: the executor runs synchronously, but
    // TypeScript's control flow does not track assignments made in callbacks.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = stubProvider("SLOW", 100, async () => {
      calls += 1;
      await gate;
      return [rawArticle()];
    });

    const router = buildRouter(h, [provider]);
    const inFlight = [router.fetch({ limit: 10 }), router.fetch({ limit: 10 }), router.fetch({ limit: 10 })];
    release();
    const results = await Promise.all(inFlight);

    expect(calls).toBe(1);
    expect(results.every((result) => result.state === "LIVE")).toBe(true);
  });
});

describe("home news router: validation and dedupe", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("drops an article below the validation floor and counts the rejection", async () => {
    h.validator.validate = vi.fn(async () => newsItem({ validationScore: 0.5 }));
    const provider = stubProvider("PRIMARY", 100, async () => [rawArticle()]);

    const result = await buildRouter(h, [provider]).fetch({ limit: 10 });

    expect(result.state).toBe("UNAVAILABLE");
    expect(h.metrics.increment).toHaveBeenCalledWith(
      "linqa_news_articles_rejected_total",
      { reason: "LOW_SCORE" }
    );
  });

  it("drops an article below the trust floor", async () => {
    h.validator.validate = vi.fn(async () => newsItem({ trustScore: 0.1 }));
    const provider = stubProvider("PRIMARY", 100, async () => [rawArticle()]);
    const result = await buildRouter(h, [provider]).fetch({ limit: 10 });
    expect(result.articles).toEqual([]);
  });

  it("records the validator's own rejection reason", async () => {
    h.validator.validate = vi.fn(async () => {
      throw new Error("PUBLISHER_BLOCKED");
    });
    const provider = stubProvider("PRIMARY", 100, async () => [rawArticle()]);

    await buildRouter(h, [provider]).fetch({ limit: 10 });

    expect(h.metrics.increment).toHaveBeenCalledWith(
      "linqa_news_articles_rejected_total",
      { reason: "PUBLISHER_BLOCKED" }
    );
  });

  it("keeps one copy when two providers report the same story", async () => {
    const shared = new Date("2026-08-29T10:00:00Z").toISOString();
    h.validator.validate = vi.fn(async (raw: RawNewsArticle) =>
      newsItem({
        title: raw.title,
        providerName: raw.providerName,
        publishedAt: shared,
        contentFingerprint: "same-story"
      })
    );
    const first = stubProvider("FIRST", 100, async () => [rawArticle({ providerName: "FIRST" })]);
    const second = stubProvider("SECOND", 50, async () => [rawArticle({ providerName: "SECOND" })]);

    const result = await buildRouter(h, [first, second]).fetch({ limit: 10 });

    expect(result.articles).toHaveLength(1);
  });

  it("sorts accepted articles newest first", async () => {
    h.validator.validate = vi.fn(async (raw: RawNewsArticle) =>
      newsItem({
        title: raw.title,
        publishedAt: raw.publishedAt,
        contentFingerprint: `fingerprint-${raw.title}`
      })
    );
    const provider = stubProvider("PRIMARY", 100, async () => [
      rawArticle({ title: "Oldest story here", publishedAt: "2026-08-29T08:00:00Z" }),
      rawArticle({ title: "Newest story here", publishedAt: "2026-08-29T12:00:00Z" }),
      rawArticle({ title: "Middle story here", publishedAt: "2026-08-29T10:00:00Z" })
    ]);

    const result = await buildRouter(h, [provider]).fetch({ limit: 10 });

    expect(result.articles.map((article) => article.title)).toEqual([
      "Newest story here",
      "Middle story here",
      "Oldest story here"
    ]);
  });

  it("persists accepted articles to the durable store", async () => {
    const provider = stubProvider("PRIMARY", 100, async () => [rawArticle()]);
    await buildRouter(h, [provider]).fetch({ limit: 10 });
    expect(h.repository.saveArticle).toHaveBeenCalledTimes(1);
  });

  it("still serves the feed when persistence fails", async () => {
    h.repository.saveArticle = vi.fn(async () => {
      throw new Error("DEADLOCK");
    });
    const provider = stubProvider("PRIMARY", 100, async () => [rawArticle()]);

    const result = await buildRouter(h, [provider]).fetch({ limit: 10 });

    expect(result.state).toBe("LIVE");
    expect(result.articles).toHaveLength(1);
  });

  it("caps how many articles it will take from one provider", async () => {
    h.validator.validate = vi.fn(async (raw: RawNewsArticle) =>
      newsItem({ title: raw.title, contentFingerprint: `fingerprint-${raw.title}` })
    );
    const flood = stubProvider("FLOOD", 100, async () =>
      Array.from({ length: 200 }, (_unused, index) => rawArticle({ title: `Flood story number ${index}` }))
    );

    const result = await buildRouter(h, [flood]).fetch({ limit: 100 });

    // maxArticlesPerProvider defaults to 40.
    expect(result.articles.length).toBeLessThanOrEqual(40);
  });

  it("passes the provider its query and an abort signal", async () => {
    let seenSignal: AbortSignal | null = null;
    const provider: NewsProvider = {
      name: "PRIMARY",
      priority: 100,
      isConfigured: () => true,
      fetch: vi.fn(async (_query: NewsQuery, signal: AbortSignal) => {
        seenSignal = signal;
        return [rawArticle()];
      })
    };

    await buildRouter(h, [provider]).fetch({ limit: 10, countryCode: "GB" });

    expect(provider.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ countryCode: "GB", limit: 10 }),
      expect.anything()
    );
    expect(seenSignal).not.toBeNull();
    expect(seenSignal!.aborted).toBe(false);
  });

  it("emits request and latency telemetry per provider", async () => {
    const provider = stubProvider("PRIMARY", 100, async () => [rawArticle()]);
    await buildRouter(h, [provider]).fetch({ limit: 10 });

    expect(h.metrics.increment).toHaveBeenCalledWith(
      "linqa_news_provider_requests_total",
      { provider: "PRIMARY" }
    );
    expect(h.metrics.observe).toHaveBeenCalledWith(
      "linqa_news_provider_latency_ms",
      expect.any(Number),
      { provider: "PRIMARY" }
    );
  });
});

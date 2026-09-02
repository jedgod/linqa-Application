import { describe, expect, it, vi } from "vitest";
import { HomeFeedService, type HomeFeedDependencies } from "../../home/home-feed.service.js";
import { HomeTelemetryService } from "../../home/home-telemetry.service.js";
import type { HomeRepository } from "../../home/home.repository.js";
import type { NewsRouterService } from "../../home/news-router.service.js";
import type { HomePersonalizationService } from "../../home/personalization.service.js";
import type { HomeNewsItem, HomePreferences, NewsState } from "../../home/home.types.js";

function newsItem(title: string): HomeNewsItem {
  return {
    providerName: "GDELT_DOC_2",
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
    breakingEligible: true
  };
}

function buildHarness(options: {
  preferences?: Partial<HomePreferences>;
  newsState?: NewsState;
  articles?: HomeNewsItem[];
  dependencies?: Partial<HomeFeedDependencies>;
  snapshotFails?: boolean;
} = {}) {
  const preferences: HomePreferences = {
    hiddenSections: [],
    preferredCategories: [],
    followedCountries: [],
    followedTopics: [],
    quickActions: [{ key: "chat" }],
    personalizationEnabled: true,
    ...options.preferences
  };

  const snapshots: unknown[] = [];
  const repository = {
    saveSnapshot: vi.fn(async (input: unknown) => {
      if (options.snapshotFails) throw new Error("SNAPSHOT_WRITE_FAILED");
      snapshots.push(input);
    })
  } as unknown as HomeRepository;

  const newsRouter = {
    fetch: vi.fn(async () => ({
      articles: options.articles ?? [newsItem("Wire service reports policy shift")],
      state: options.newsState ?? ("LIVE" as NewsState)
    }))
  } as unknown as NewsRouterService;

  const rankNews = vi.fn((articles: HomeNewsItem[]) => articles);
  const personalization = {
    getPreferences: vi.fn(async () => preferences),
    rankNews
  } as unknown as HomePersonalizationService;

  const metrics = { increment: vi.fn(), observe: vi.fn() };
  const telemetry = new HomeTelemetryService(metrics);

  const dependencies: HomeFeedDependencies = {
    getProfile: vi.fn(async () => ({ userId: "u1", displayName: "Test User" })),
    getNotifications: vi.fn(async () => ({ unreadMessages: 3, total: 3 })),
    getCountryLinqa: vi.fn(async () => ({ countryCode: "US", countryName: "United States" })),
    getUpcoming: vi.fn(async () => Array.from({ length: 30 }, (_u, i) => ({ id: `event-${i}` }))),
    getContinueYourDay: vi.fn(async () => Array.from({ length: 30 }, (_u, i) => ({ id: `conversation-${i}` }))),
    getVaultRecent: vi.fn(async () => Array.from({ length: 30 }, (_u, i) => ({ id: `vault-${i}` }))),
    getPendingTransfers: vi.fn(async () => Array.from({ length: 30 }, (_u, i) => ({ id: `transfer-${i}` }))),
    getLiveUpdates: vi.fn(async () => Array.from({ length: 30 }, (_u, i) => ({ id: `live-${i}` }))),
    getSpotlight: vi.fn(async () => ({ id: "spotlight-1" })),
    ...options.dependencies
  };

  return {
    service: new HomeFeedService(repository, newsRouter, personalization, telemetry, dependencies),
    repository,
    newsRouter,
    personalization,
    rankNews,
    dependencies,
    metrics,
    snapshots
  };
}

describe("home feed: payload contract", () => {
  it("builds an authenticated feed for the resolved jurisdiction", async () => {
    const h = buildHarness();
    const feed = await h.service.build("u1", "US");

    expect(feed.jurisdictionCountry).toBe("US");
    expect(feed.serviceState.news).toBe("LIVE");
    expect(feed.serviceState.personalized).toBe(true);
    expect(feed.breakingAroundWorld).toHaveLength(1);
    expect(feed.profile).toEqual({ userId: "u1", displayName: "Test User" });
    expect(feed.quickActions).toEqual([{ key: "chat" }]);
    expect(new Date(feed.generatedAt).toString()).not.toBe("Invalid Date");
  });

  it("reports UNAVAILABLE honestly and ships no articles", async () => {
    const h = buildHarness({ newsState: "UNAVAILABLE", articles: [] });
    const feed = await h.service.build("u1", "US");

    expect(feed.serviceState.news).toBe("UNAVAILABLE");
    expect(feed.breakingAroundWorld).toEqual([]);
  });

  it("marks a stale feed as STALE rather than LIVE", async () => {
    const h = buildHarness({ newsState: "STALE" });
    const feed = await h.service.build("u1", "US");
    expect(feed.serviceState.news).toBe("STALE");
  });

  it("caps each list section at its configured maximum", async () => {
    const h = buildHarness();
    const feed = await h.service.build("u1", "US");

    expect(feed.upcoming.length).toBeLessThanOrEqual(10);
    expect(feed.continueYourDay.length).toBeLessThanOrEqual(12);
    expect(feed.vaultRecent.length).toBeLessThanOrEqual(4);
    expect(feed.pendingTransfers.length).toBeLessThanOrEqual(4);
    expect(feed.liveUpdates.length).toBeLessThanOrEqual(6);
  });

  it("persists a hashed snapshot of what the user was served", async () => {
    const h = buildHarness();
    await h.service.build("u1", "US");

    expect(h.repository.saveSnapshot).toHaveBeenCalledTimes(1);
    const snapshot = h.snapshots[0] as { userId: string; country: string; hash: string };
    expect(snapshot.userId).toBe("u1");
    expect(snapshot.country).toBe("US");
    expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records feed latency", async () => {
    const h = buildHarness();
    await h.service.build("u1", "US");
    expect(h.metrics.observe).toHaveBeenCalledWith("linqa_home_feed_latency_ms", expect.any(Number));
  });
});

describe("home feed: hidden sections", () => {
  it("does not expose a hidden section, and does not even fetch it", async () => {
    const h = buildHarness({
      preferences: { hiddenSections: ["spotlight", "upcoming", "liveUpdates", "countryLinqa", "continueYourDay"] }
    });
    const feed = await h.service.build("u1", "US");

    expect(feed.spotlight).toBeUndefined();
    expect("spotlight" in feed).toBe(false);
    expect(feed.upcoming).toEqual([]);
    expect(feed.liveUpdates).toEqual([]);
    expect(feed.continueYourDay).toEqual([]);
    // Vault and in-flight money live inside "Continue your day", so hiding
    // that section has to silence all three lanes, not just conversations.
    expect(feed.vaultRecent).toEqual([]);
    expect(feed.pendingTransfers).toEqual([]);
    expect(feed.countryLinqa).toBeNull();

    // Hiding a section should also stop the work behind it, not just filter
    // the response.
    expect(h.dependencies.getSpotlight).not.toHaveBeenCalled();
    expect(h.dependencies.getUpcoming).not.toHaveBeenCalled();
    expect(h.dependencies.getLiveUpdates).not.toHaveBeenCalled();
    expect(h.dependencies.getCountryLinqa).not.toHaveBeenCalled();
    expect(h.dependencies.getVaultRecent).not.toHaveBeenCalled();
    expect(h.dependencies.getPendingTransfers).not.toHaveBeenCalled();
  });

  it("does not call the news router when world news is hidden", async () => {
    const h = buildHarness({ preferences: { hiddenSections: ["breakingAroundWorld"] } });
    const feed = await h.service.build("u1", "US");

    expect(h.newsRouter.fetch).not.toHaveBeenCalled();
    expect(feed.breakingAroundWorld).toEqual([]);
  });

  it("echoes the hidden set so a client can tell hidden from empty", async () => {
    const h = buildHarness({ preferences: { hiddenSections: ["spotlight"] } });
    const feed = await h.service.build("u1", "US");
    expect(feed.serviceState.hiddenSections).toEqual(["spotlight"]);
  });
});

describe("home feed: personalization control", () => {
  it("does not re-rank when personalization is disabled", async () => {
    const articles = [newsItem("First story here"), newsItem("Second story here")];
    const h = buildHarness({ preferences: { personalizationEnabled: false }, articles });

    // The real ranker short-circuits when disabled; assert the flag reaches
    // the payload and the order is preserved.
    const feed = await h.service.build("u1", "US");

    expect(feed.serviceState.personalized).toBe(false);
    expect(feed.breakingAroundWorld.map((item) => item.title)).toEqual([
      "First story here",
      "Second story here"
    ]);
  });

  it("passes preferences and jurisdiction to the ranker", async () => {
    const h = buildHarness({ preferences: { preferredCategories: ["HEALTH"] } });
    await h.service.build("u1", "KE");

    expect(h.rankNews).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ preferredCategories: ["HEALTH"] }),
      "KE"
    );
  });
});

describe("home feed: degradation", () => {
  it("keeps rendering when one section throws, and names it", async () => {
    const h = buildHarness({
      dependencies: {
        getSpotlight: vi.fn(async () => {
          throw new Error("SPOTLIGHT_QUERY_FAILED");
        })
      }
    });

    const feed = await h.service.build("u1", "US");

    expect(feed.serviceState.degraded).toContain("spotlight");
    expect(feed.spotlight).toBeUndefined();
    // The rest of Home is intact.
    expect(feed.profile).toBeTruthy();
    expect(feed.breakingAroundWorld).toHaveLength(1);
  });

  it("keeps the conversation lane when Vault and transfers both fail", async () => {
    const h = buildHarness({
      dependencies: {
        getVaultRecent: vi.fn(async () => {
          throw new Error("VAULT_INDEX_UNAVAILABLE");
        }),
        getPendingTransfers: vi.fn(async () => {
          throw new Error("LEDGER_UNAVAILABLE");
        })
      }
    });

    const feed = await h.service.build("u1", "US");

    expect(feed.serviceState.degraded).toContain("vault");
    expect(feed.serviceState.degraded).toContain("transfers");
    expect(feed.vaultRecent).toEqual([]);
    expect(feed.pendingTransfers).toEqual([]);
    // A money-service outage must not take the user's conversations with it.
    expect(feed.continueYourDay.length).toBeGreaterThan(0);
  });

  it("reports UNAVAILABLE news when the router itself throws", async () => {
    const h = buildHarness();
    (h.newsRouter.fetch as unknown as { mockRejectedValue(error: Error): void }).mockRejectedValue(
      new Error("ROUTER_EXPLODED")
    );

    const feed = await h.service.build("u1", "US");

    expect(feed.serviceState.news).toBe("UNAVAILABLE");
    expect(feed.serviceState.degraded).toContain("news");
    expect(feed.breakingAroundWorld).toEqual([]);
  });

  it("counts a section failure separately from a feed failure", async () => {
    const h = buildHarness({
      dependencies: {
        getNotifications: vi.fn(async () => {
          throw new Error("NOTIFICATION_COUNT_FAILED");
        })
      }
    });

    await h.service.build("u1", "US");

    expect(h.metrics.increment).toHaveBeenCalledWith(
      "linqa_home_section_failures_total",
      { section: "notifications", reason: "NOTIFICATION_COUNT_FAILED" }
    );
    expect(h.metrics.increment).not.toHaveBeenCalledWith(
      "linqa_home_feed_failures_total",
      expect.anything()
    );
  });

  it("still serves Home when the snapshot write fails", async () => {
    const h = buildHarness({ snapshotFails: true });
    const feed = await h.service.build("u1", "US");

    expect(feed.serviceState.degraded).toContain("snapshot");
    expect(feed.profile).toBeTruthy();
  });

  it("propagates and counts a genuine feed failure", async () => {
    const h = buildHarness();
    (h.personalization.getPreferences as unknown as { mockRejectedValue(error: Error): void }).mockRejectedValue(
      new Error("PREFERENCES_UNAVAILABLE")
    );

    await expect(h.service.build("u1", "US")).rejects.toThrow("PREFERENCES_UNAVAILABLE");
    expect(h.metrics.increment).toHaveBeenCalledWith(
      "linqa_home_feed_failures_total",
      { reason: "PREFERENCES_UNAVAILABLE" }
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bannerLabel, selectBannerStories } from "../clients/mobile/components/home/news-banner.ts";
import type { HomeNewsItem } from "../clients/mobile/services/home-feed.service.ts";

const article = (id: number, category = "WORLD", title = `Headline ${id}`): HomeNewsItem => ({
  title, category, canonicalUrl: `https://example.com/${id}`, publisherDomain: `publisher-${id % 3}.com`,
  publisherName: "Publisher", publishedAt: "2026-10-16T12:00:00Z", providerName: "test",
  publisherTrustStatus: "TRUSTED", attributionRequired: true, breakingEligible: false
});

describe("Home news banner", () => {
  it("shows weather early even when it has no image and arrives after many headlines", () => {
    const weather = article(30, "CLIMATE", "Storm warning for coastal communities");
    const general = Array.from({ length: 25 }, (_, i) => article(i));
    const selected = selectBannerStories([...general, weather, general[0]!], 20);
    assert.equal(selected.length, 20);
    assert.equal(selected[1], weather);
    assert.equal(new Set(selected.map(item => item.canonicalUrl)).size, 20);
    assert.notEqual(selected[0]?.publisherDomain, selected[2]?.publisherDomain);
  });

  it("labels weather and climate honestly and preserves breaking clearance", () => {
    assert.equal(bannerLabel(article(1, "WORLD", "Heavy rainfall expected")), "WEATHER NEWS");
    assert.equal(bannerLabel(article(2, "CLIMATE", "Emissions agreement announced")), "CLIMATE NEWS");
    assert.equal(bannerLabel(article(3)), "WORLD NEWS");
    assert.equal(bannerLabel(article(5, "BUSINESS", "Economic forecast improves")), "WORLD NEWS");
    assert.equal(bannerLabel({ ...article(4), breakingEligible: true }), "BREAKING NEWS");
    assert.deepEqual(selectBannerStories([], 20), []);
  });
});

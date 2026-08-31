/**
 * Populates Home's news tier through the *real* pipeline so the LIVE
 * rendering path can be exercised on a device with no outbound internet.
 *
 * This is not a fixture insert: articles go through NewsValidationService
 * (HTTPS + publisher trust + canonicalization + scoring) and the real
 * NewsRouterService (dedupe, persistence, cache write), exactly as a live
 * GDELT response would. Anything that would be rejected in production is
 * rejected here too.
 *
 *   DATABASE_URL=... [REDIS_URL=...] npx tsx src/dev/home-seed-live-news.ts
 */
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { homeProductionConfig } from "../config/home-production.config.js";
import { createHomeModule } from "../home/home.module.js";
import type { NewsProvider } from "../home/news-provider.js";
import type { NewsQuery, RawNewsArticle } from "../home/home.types.js";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

// Headlines are neutral, non-specific wording: this seeds the rendering path,
// it does not assert real-world events.
const FIXTURES: RawNewsArticle[] = [
  {
    providerName: "GDELT_DOC_2",
    title: "Central bank keeps its benchmark interest rate unchanged",
    url: "https://reuters.com/markets/rates/decision-summary?utm_source=seed",
    summary: "Policymakers described the decision as a pause while they assess incoming data.",
    imageUrl: "https://images.example/rates.jpg",
    publisherDomain: "reuters.com",
    publishedAt: minutesAgo(12),
    countryCode: "United States",
    sourceLanguage: "English",
    category: "BUSINESS",
    providerScore: 0.7
  },
  {
    providerName: "GDELT_DOC_2",
    title: "Regional leaders conclude summit with a joint energy statement",
    url: "https://apnews.com/world/regional-summit-energy",
    summary: "Delegations agreed to continue technical talks through the year.",
    imageUrl: "https://images.example/summit.jpg",
    publisherDomain: "apnews.com",
    publishedAt: minutesAgo(38),
    countryCode: "United States",
    sourceLanguage: "English",
    category: "POLITICS",
    providerScore: 0.7
  },
  {
    providerName: "GDELT_DOC_2",
    title: "Researchers publish findings from a multi-year climate study",
    url: "https://bbc.com/science/climate-study-findings",
    summary: "The paper reports observations collected across several monitoring sites.",
    imageUrl: "https://images.example/climate.jpg",
    publisherDomain: "bbc.com",
    publishedAt: minutesAgo(55),
    countryCode: "United Kingdom",
    sourceLanguage: "English",
    category: "CLIMATE",
    providerScore: 0.7
  },
  {
    providerName: "GDELT_DOC_2",
    title: "Health authority updates its seasonal vaccination guidance",
    url: "https://npr.org/health/vaccination-guidance-update",
    summary: "The guidance revises recommended timing for several age groups.",
    publisherDomain: "npr.org",
    publishedAt: minutesAgo(74),
    countryCode: "United States",
    sourceLanguage: "English",
    category: "HEALTH",
    providerScore: 0.7
  },
  {
    providerName: "GDELT_DOC_2",
    title: "Semiconductor manufacturer outlines new capacity investment",
    url: "https://theverge.com/tech/fab-capacity-investment",
    summary: "The company said construction would proceed in phases.",
    imageUrl: "https://images.example/fab.jpg",
    publisherDomain: "theverge.com",
    publishedAt: minutesAgo(96),
    countryCode: "United States",
    sourceLanguage: "English",
    category: "TECHNOLOGY",
    providerScore: 0.7
  },
  {
    // Must be rejected: publishing platform, BLOCKED in the seeded allowlist.
    providerName: "GDELT_DOC_2",
    title: "A widely shared post recaps the summit outcome",
    url: "https://medium.com/@someone/summit-recap",
    publisherDomain: "medium.com",
    publishedAt: minutesAgo(20),
    providerScore: 0.99
  },
  {
    // Must be rejected: plaintext link.
    providerName: "GDELT_DOC_2",
    title: "Plaintext mirror of the rate decision coverage",
    url: "http://reuters.com/markets/rates/insecure-mirror",
    publisherDomain: "reuters.com",
    publishedAt: minutesAgo(15),
    providerScore: 0.7
  }
];

class SeedProvider implements NewsProvider {
  readonly name = "GDELT_DOC_2";
  readonly priority = 100;
  isConfigured() {
    return true;
  }
  async fetch(query: NewsQuery): Promise<RawNewsArticle[]> {
    if (!query.countryCode) return FIXTURES;
    // Country-scoped refresh returns only that jurisdiction's stories.
    return FIXTURES.filter((article) => {
      const code = article.countryCode ?? "";
      return code === query.countryCode || code === "United States";
    });
  }
}

const config = loadConfig();
const db = createPool(config);
const home = createHomeModule({ db, redisUrl: config.REDIS_URL, providers: [new SeedProvider()] });

try {
  // Clear the breaker so a previous no-network run does not skip the provider.
  await home.providerHealth.setState("GDELT_DOC_2", "HEALTHY");
  await home.providerHealth.setState("APPROVED_RSS", "HEALTHY");

  // Warm exactly the keys the Home feed and the refresh job read.
  const global = await home.router.fetch({ limit: homeProductionConfig.feed.maxNewsItems });
  console.log(`global feed: ${global.state} with ${global.articles.length} articles`);
  for (const article of global.articles) {
    console.log(`  - [${article.category}] ${article.publisherName} :: ${article.title}`);
  }

  const us = await home.router.fetch({ countryCode: "US", limit: 30 });
  console.log(`US feed: ${us.state} with ${us.articles.length} articles`);

  const stored = await home.repository.listArticles({ limit: 20 });
  console.log(`durable store now holds ${stored.length} live articles`);
  console.log(`breaking now: ${stored.filter((row) => row.breaking).length}`);
} finally {
  await home.close();
  await db.end();
}

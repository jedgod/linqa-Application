import { describe, expect, it, vi } from "vitest";
import {
  HomePersonalizationService,
  sanitizeHomePreferences
} from "../../home/personalization.service.js";
import type { Database } from "../../db/pool.js";
import type { HomePreferences } from "../../home/home.types.js";

function preferences(overrides: Partial<HomePreferences> = {}): HomePreferences {
  return {
    hiddenSections: [],
    preferredCategories: [],
    followedCountries: [],
    followedTopics: [],
    quickActions: [],
    personalizationEnabled: true,
    ...overrides
  };
}

type Item = { title: string; category: string; countryCode?: string; publishedAt: string };

const NOW = Date.now();
const items: Item[] = [
  { title: "Global markets steady", category: "BUSINESS", countryCode: "US", publishedAt: new Date(NOW - 30 * 60_000).toISOString() },
  { title: "Parliament debates energy bill", category: "POLITICS", countryCode: "GB", publishedAt: new Date(NOW - 60 * 60_000).toISOString() },
  { title: "Hospital trial results published", category: "HEALTH", countryCode: "KE", publishedAt: new Date(NOW - 90 * 60_000).toISOString() }
];

describe("home personalization: preference sanitization", () => {
  it('keeps ordered known shortcuts and removes duplicates, arbitrary routes and malformed data', () => {
    const result = sanitizeHomePreferences({ quickActions: [{ key: 'vault', route: 'https://example.com' }, { key: 'chat' }, { key: 'vault' }, { key: 'unknown' }, null] });
    expect(result.quickActions).toEqual([{ key: 'vault' }, { key: 'chat' }]);
  });
  it("drops unknown hideable sections", () => {
    const result = sanitizeHomePreferences({ hiddenSections: ["spotlight", "notARealSection", "profile"] });
    expect(result.hiddenSections).toEqual(["spotlight"]);
  });

  it("drops unknown categories and upper-cases the rest", () => {
    const result = sanitizeHomePreferences({ preferredCategories: ["politics", "ASTROLOGY", "health"] });
    expect(result.preferredCategories).toEqual(["POLITICS", "HEALTH"]);
  });

  it("keeps only two-letter country codes so CHAR(2) cannot overflow", () => {
    const result = sanitizeHomePreferences({ followedCountries: ["gb", "United Kingdom", "US", "USA"] });
    expect(result.followedCountries).toEqual(["GB", "US"]);
  });

  it("de-duplicates list entries", () => {
    const result = sanitizeHomePreferences({ followedCountries: ["GB", "gb", "GB"] });
    expect(result.followedCountries).toEqual(["GB"]);
  });

  it("caps list length and topic length", () => {
    const result = sanitizeHomePreferences({
      followedTopics: Array.from({ length: 100 }, (_unused, index) => `topic-${index}`).concat(["x".repeat(200)])
    });
    expect(result.followedTopics.length).toBeLessThanOrEqual(24);
    for (const topic of result.followedTopics) expect(topic.length).toBeLessThanOrEqual(48);
  });

  it("defaults personalization to off when not explicitly enabled", () => {
    expect(sanitizeHomePreferences({}).personalizationEnabled).toBe(false);
    expect(sanitizeHomePreferences({ personalizationEnabled: "yes" }).personalizationEnabled).toBe(false);
    expect(sanitizeHomePreferences({ personalizationEnabled: true }).personalizationEnabled).toBe(true);
  });

  it("tolerates junk input without throwing", () => {
    expect(sanitizeHomePreferences(null)).toEqual({
      hiddenSections: [],
      preferredCategories: [],
      followedCountries: [],
      followedTopics: [],
      quickActions: [],
      personalizationEnabled: false
    });
    expect(sanitizeHomePreferences({ hiddenSections: "spotlight" }).hiddenSections).toEqual([]);
  });
});

describe("home personalization: ranking", () => {
  const service = new HomePersonalizationService({} as unknown as Database);

  it("returns the input untouched when personalization is disabled", () => {
    const result = service.rankNews(items, preferences({
      personalizationEnabled: false,
      preferredCategories: ["HEALTH"]
    }), "KE");
    expect(result).toEqual(items);
  });

  it("promotes a preferred category", () => {
    const result = service.rankNews(items, preferences({ preferredCategories: ["HEALTH"] }), "US");
    expect(result[0]?.category).toBe("HEALTH");
  });

  it("promotes a followed country", () => {
    const result = service.rankNews(items, preferences({ followedCountries: ["GB"] }), "US");
    expect(result[0]?.countryCode).toBe("GB");
  });

  it("promotes a followed topic matched in the headline", () => {
    const result = service.rankNews(items, preferences({ followedTopics: ["energy"] }), "US");
    expect(result[0]?.title).toContain("energy");
  });

  it("gives the user's own jurisdiction a nudge", () => {
    const result = service.rankNews(items, preferences(), "KE");
    expect(result[0]?.countryCode).toBe("KE");
  });

  it("keeps recency order when nothing else distinguishes items", () => {
    const result = service.rankNews(items, preferences(), "ZZ");
    expect(result.map((item) => item.title)).toEqual(items.map((item) => item.title));
  });

  it("never adds or loses items", () => {
    const result = service.rankNews(items, preferences({ preferredCategories: ["HEALTH"] }), "GB");
    expect(result).toHaveLength(items.length);
    expect(new Set(result.map((item) => item.title))).toEqual(new Set(items.map((item) => item.title)));
  });

  it("does not mutate the caller's array", () => {
    const original = [...items];
    service.rankNews(items, preferences({ preferredCategories: ["HEALTH"] }), "GB");
    expect(items).toEqual(original);
  });

  it("tolerates items with no timestamp or country", () => {
    const sparse = [{ title: "No metadata story", category: "WORLD", publishedAt: "not-a-date" }];
    expect(() => service.rankNews(sparse, preferences(), "GB")).not.toThrow();
  });
});

describe("home personalization: persistence", () => {
  it("returns off-by-default preferences for a user with no row", async () => {
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database;
    const service = new HomePersonalizationService(db);

    const result = await service.getPreferences("u1");

    expect(result.personalizationEnabled).toBe(false);
    expect(result.hiddenSections).toEqual([]);
  });

  it("trims the space padding PostgreSQL CHAR(2) can introduce", async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [{
          hidden_sections: ["spotlight"],
          preferred_categories: ["POLITICS"],
          followed_countries: ["GB", "u "],
          followed_topics: ["energy"],
          quick_actions: [],
          personalization_enabled: true
        }],
        rowCount: 1
      }))
    } as unknown as Database;

    const result = await new HomePersonalizationService(db).getPreferences("u1");

    expect(result.followedCountries).toEqual(["GB", "U"]);
  });

  it("sanitizes before writing and returns what was stored", async () => {
    const calls: unknown[][] = [];
    const db = {
      query: vi.fn(async (_sql: string, params: unknown[]) => {
        calls.push(params);
        return { rows: [], rowCount: 1 };
      })
    } as unknown as Database;

    const stored = await new HomePersonalizationService(db).savePreferences("u1", {
      hiddenSections: ["spotlight", "bogus"],
      followedCountries: ["gb", "United Kingdom"],
      personalizationEnabled: true
    });

    expect(stored.hiddenSections).toEqual(["spotlight"]);
    expect(stored.followedCountries).toEqual(["GB"]);
    expect(calls[0]?.[1]).toEqual(["spotlight"]);
    expect(calls[0]?.[3]).toEqual(["GB"]);
  });
});

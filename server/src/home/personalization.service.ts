import type { Database } from "../db/pool.js";
import { HIDEABLE_HOME_SECTIONS, type HomePreferences } from "./home.types.js";
import { HOME_NEWS_CATEGORIES } from "./news-normalization.js";

const DEFAULT_PREFERENCES: HomePreferences = {
  hiddenSections: [],
  preferredCategories: [],
  followedCountries: [],
  followedTopics: [],
  quickActions: [],
  // A user who has never expressed a preference is not personalized. Ranking
  // someone's feed by inferred interest without them asking is the behaviour
  // the pack's "feed personalization is user-controlled" requirement rules out.
  personalizationEnabled: false
};

const MAX_LIST_ENTRIES = 24;
const MAX_TOPIC_LENGTH = 48;
const ACTION_KEYS = new Set(['chat', 'call', 'send', 'vault', 'event', 'post', 'more']);
function quickActions(value: unknown): Array<{ key: string }> {
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  for (const item of value) {
    const key = item && typeof item === 'object' ? (item as { key?: unknown }).key : undefined;
    if (typeof key === 'string' && ACTION_KEYS.has(key) && !keys.includes(key)) keys.push(key);
  }
  return keys.map(key => ({ key }));
}

function uniqueStrings(values: unknown, transform: (value: string) => string | null): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const normalized = transform(raw);
    if (normalized && !result.includes(normalized)) result.push(normalized);
    if (result.length >= MAX_LIST_ENTRIES) break;
  }
  return result;
}

/**
 * Normalizes a client-supplied preference document into something safe to
 * store. Unknown sections and categories are dropped rather than rejected so
 * an older client cannot be locked out by a newer taxonomy, but everything
 * stored is from a known set.
 */
export function sanitizeHomePreferences(input: unknown): HomePreferences {
  const source = (input ?? {}) as Record<string, unknown>;
  return {
    hiddenSections: uniqueStrings(source.hiddenSections, (value) =>
      (HIDEABLE_HOME_SECTIONS as readonly string[]).includes(value) ? value : null
    ),
    preferredCategories: uniqueStrings(source.preferredCategories, (value) => {
      const upper = value.trim().toUpperCase();
      return (HOME_NEWS_CATEGORIES as readonly string[]).includes(upper) ? upper : null;
    }),
    followedCountries: uniqueStrings(source.followedCountries, (value) => {
      const upper = value.trim().toUpperCase();
      // The column is CHAR(2)[]; anything else would be silently padded or
      // rejected by PostgreSQL.
      return /^[A-Z]{2}$/.test(upper) ? upper : null;
    }),
    followedTopics: uniqueStrings(source.followedTopics, (value) => {
      const trimmed = value.trim().slice(0, MAX_TOPIC_LENGTH);
      return trimmed.length >= 2 ? trimmed : null;
    }),
    quickActions: quickActions(source.quickActions),
    personalizationEnabled: source.personalizationEnabled === true
  };
}

export class HomePersonalizationService {
  constructor(private readonly db: Database) {}

  async getPreferences(userId: string): Promise<HomePreferences> {
    const result = await this.db.query(
      `SELECT hidden_sections,preferred_categories,followed_countries,followed_topics,quick_actions,
              personalization_enabled
       FROM home_feed_preferences WHERE user_id=$1`,
      [userId]
    );
    if (!result.rowCount) return { ...DEFAULT_PREFERENCES };

    const row = result.rows[0] as {
      hidden_sections: string[] | null;
      preferred_categories: string[] | null;
      followed_countries: string[] | null;
      followed_topics: string[] | null;
      quick_actions: unknown[] | null;
      personalization_enabled: boolean | null;
    };

    return {
      hiddenSections: row.hidden_sections ?? [],
      preferredCategories: row.preferred_categories ?? [],
      // CHAR(2)[] comes back space-padded if anything ever wrote a short value.
      followedCountries: (row.followed_countries ?? []).map((code) => code.trim().toUpperCase()),
      followedTopics: row.followed_topics ?? [],
      quickActions: quickActions(row.quick_actions),
      personalizationEnabled: Boolean(row.personalization_enabled)
    };
  }

  async savePreferences(userId: string, input: unknown): Promise<HomePreferences> {
    const preferences = sanitizeHomePreferences(input);
    await this.db.query(
      `INSERT INTO home_feed_preferences
         (user_id,hidden_sections,preferred_categories,followed_countries,followed_topics,
          quick_actions,personalization_enabled)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT(user_id) DO UPDATE SET
         hidden_sections=EXCLUDED.hidden_sections,
         preferred_categories=EXCLUDED.preferred_categories,
         followed_countries=EXCLUDED.followed_countries,
         followed_topics=EXCLUDED.followed_topics,
         quick_actions=EXCLUDED.quick_actions,
         personalization_enabled=EXCLUDED.personalization_enabled,
         updated_at=now()`,
      [
        userId,
        preferences.hiddenSections,
        preferences.preferredCategories,
        preferences.followedCountries,
        preferences.followedTopics,
        JSON.stringify(preferences.quickActions),
        preferences.personalizationEnabled
      ]
    );
    return preferences;
  }

  /**
   * Stable interest ranking. Returns the input untouched when personalization
   * is off, which is what the "does not personalize when disabled" release
   * test pins.
   */
  rankNews<T extends { title?: string; category?: string; countryCode?: string; publishedAt?: string }>(
    items: T[],
    preferences: HomePreferences,
    jurisdictionCountry: string
  ): T[] {
    if (!preferences.personalizationEnabled) return items;

    const topics = preferences.followedTopics.map((topic) => topic.toLowerCase());

    return items
      .map((item, index) => {
        let score = 0;
        if (item.category && preferences.preferredCategories.includes(item.category)) score += 20;
        if (item.countryCode && preferences.followedCountries.includes(item.countryCode)) score += 15;
        if (item.countryCode === jurisdictionCountry) score += 10;
        if (topics.length && item.title) {
          const haystack = item.title.toLowerCase();
          if (topics.some((topic) => haystack.includes(topic))) score += 12;
        }
        if (item.publishedAt) {
          const ageMinutes = (Date.now() - Date.parse(item.publishedAt)) / 60_000;
          if (Number.isFinite(ageMinutes)) score += Math.max(0, 10 - ageMinutes / 30);
        }
        return { item, score, index };
      })
      // `index` is the tiebreaker so equal-scoring items keep the router's
      // recency order instead of depending on sort stability.
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .map((entry) => entry.item);
  }
}

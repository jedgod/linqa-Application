import { createHash } from "node:crypto";

export type GlobalNewsStatus = "LIVE" | "STALE" | "UNAVAILABLE";

export interface GlobalNewsStory {
  id: string;
  title: string;
  url: string;
  imageUrl: string | null;
  source: string;
  sourceCountry: string | null;
  category: "WORLD" | "POLITICS" | "TECHNOLOGY" | "HEALTH" | "CLIMATE" | "BUSINESS" | "SCIENCE" | "SPORTS";
  publishedAt: string;
}

export interface GlobalNewsFeed {
  status: GlobalNewsStatus;
  refreshedAt: string;
  stories: GlobalNewsStory[];
}

type GdeltArticle = {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  socialimage?: unknown;
  domain?: unknown;
  sourcecountry?: unknown;
};

type CachedFeed = { fetchedAt: number; feed: GlobalNewsFeed };

const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const CACHE_TTL_MS = 5 * 60_000;
const STALE_TTL_MS = 60 * 60_000;

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function decodeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length >= 8 && clean.length <= 240 ? clean : null;
}

function parseSeenDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function categoryFor(title: string): GlobalNewsStory["category"] {
  const value = title.toLowerCase();
  if (/election|president|minister|senate|parliament|government|policy|diploma/.test(value)) return "POLITICS";
  if (/ai\b|artificial intelligence|technology|software|cyber|robot|chip|digital/.test(value)) return "TECHNOLOGY";
  if (/health|hospital|medical|disease|virus|vaccine|who\b/.test(value)) return "HEALTH";
  if (/climate|weather|storm|flood|wildfire|emission|energy/.test(value)) return "CLIMATE";
  if (/market|econom|business|bank|trade|company|finance/.test(value)) return "BUSINESS";
  if (/science|space|nasa|research|study|discovery/.test(value)) return "SCIENCE";
  if (/sport|football|soccer|basketball|tennis|champion|league/.test(value)) return "SPORTS";
  return "WORLD";
}

function storyId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 24);
}

export class GlobalNewsService {
  private cache: CachedFeed | null = null;
  private inFlight: Promise<GlobalNewsFeed> | null = null;

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async load(): Promise<GlobalNewsFeed> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) return this.cache.feed;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.fetchLive()
      .then((feed) => {
        this.cache = { fetchedAt: Date.now(), feed };
        return feed;
      })
      .catch(() => {
        if (this.cache && now - this.cache.fetchedAt < STALE_TTL_MS) {
          return { ...this.cache.feed, status: "STALE" as const };
        }
        return { status: "UNAVAILABLE" as const, refreshedAt: new Date().toISOString(), stories: [] };
      })
      .finally(() => { this.inFlight = null; });

    return this.inFlight;
  }

  private async fetchLive(): Promise<GlobalNewsFeed> {
    const params = new URLSearchParams({
      query: "(world OR global)",
      mode: "artlist",
      maxrecords: "30",
      timespan: "24h",
      sort: "datedesc",
      format: "json"
    });
    const response = await this.fetcher(`${GDELT_DOC_URL}?${params}`, {
      headers: { accept: "application/json", "user-agent": "Linqa/1.0 global-news-home-feed" },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`global news provider returned ${response.status}`);
    const body = await response.json() as { articles?: GdeltArticle[] };
    const seen = new Set<string>();
    const stories: GlobalNewsStory[] = [];

    for (const article of Array.isArray(body.articles) ? body.articles : []) {
      const url = safeHttpsUrl(article.url);
      const title = decodeTitle(article.title);
      const publishedAt = parseSeenDate(article.seendate);
      if (!url || !title || !publishedAt) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const parsed = new URL(url);
      stories.push({
        id: storyId(url),
        title,
        url,
        imageUrl: safeHttpsUrl(article.socialimage),
        source: typeof article.domain === "string" && article.domain.trim() ? article.domain.trim().slice(0, 120) : parsed.hostname,
        sourceCountry: typeof article.sourcecountry === "string" && article.sourcecountry.trim() ? article.sourcecountry.trim().slice(0, 80) : null,
        category: categoryFor(title),
        publishedAt
      });
      if (stories.length === 18) break;
    }
    if (stories.length < 4) throw new Error("global news provider returned too few usable stories");
    return { status: "LIVE", refreshedAt: new Date().toISOString(), stories };
  }
}

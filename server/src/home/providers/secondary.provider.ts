import type { NewsProvider } from "../news-provider.js";
import type { NewsQuery, RawNewsArticle } from "../home.types.js";
import {
  categoryForHeadline,
  cleanPublisherText,
  toIso2CountryCode,
  toIso639Language,
  toIsoTimestamp
} from "../news-normalization.js";

type SecondaryItem = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  summary?: unknown;
  imageUrl?: unknown;
  publisherName?: unknown;
  publisherDomain?: unknown;
  publishedAt?: unknown;
  category?: unknown;
  countryCode?: unknown;
  sourceLanguage?: unknown;
  providerScore?: unknown;
};

/**
 * Second news lane, required by the release gate's provider-redundancy check:
 * Home must never depend on a single upstream. The contract is an HTTPS
 * endpoint returning `{ items: [...] }` where each item carries at least a
 * title, an HTTPS url and a timestamp — i.e. an already-contracted publisher
 * aggregation, not a scrape.
 *
 * The endpoint is read on every call rather than captured at construction so
 * a configuration change takes effect on the next refresh cycle instead of
 * requiring a process restart.
 */
export class ApprovedSecondaryProvider implements NewsProvider {
  readonly name = "APPROVED_RSS";
  readonly priority = 50;

  constructor(
    private readonly endpointOverride?: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private endpoint(): string | undefined {
    const raw = this.endpointOverride ?? process.env.HOME_APPROVED_RSS_ENDPOINT;
    if (!raw) return undefined;
    try {
      // Only HTTPS: an http endpoint here would silently reintroduce the
      // plaintext-link path the validator exists to block.
      return new URL(raw).protocol === "https:" ? raw : undefined;
    } catch {
      return undefined;
    }
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint());
  }

  async fetch(query: NewsQuery, signal: AbortSignal): Promise<RawNewsArticle[]> {
    const endpoint = this.endpoint();
    if (!endpoint) return [];

    const url = new URL(endpoint);
    if (query.countryCode) url.searchParams.set("country", query.countryCode);
    if (query.categories?.length) url.searchParams.set("categories", query.categories.join(","));
    url.searchParams.set("limit", String(query.limit));
    if (query.breakingOnly) url.searchParams.set("breaking", "true");

    const headers: Record<string, string> = { accept: "application/json" };
    const token = process.env.HOME_APPROVED_RSS_TOKEN;
    if (token) headers.authorization = `Bearer ${token}`;

    const response = await this.fetcher(url, { headers, signal, redirect: "error" });
    if (!response.ok) throw new Error(`APPROVED_RSS_HTTP_${response.status}`);

    const body = await response.json() as { items?: SecondaryItem[] };
    const items = Array.isArray(body.items) ? body.items : [];
    const results: RawNewsArticle[] = [];

    for (const item of items.slice(0, query.limit)) {
      if (typeof item.url !== "string" || typeof item.title !== "string") continue;
      const title = cleanPublisherText(item.title);
      const publishedAt = toIsoTimestamp(item.publishedAt);
      if (!title || !publishedAt) continue;

      const providerScore = typeof item.providerScore === "number" && Number.isFinite(item.providerScore)
        ? Math.max(0, Math.min(1, item.providerScore))
        : 0.85;

      const article: RawNewsArticle = {
        providerName: this.name,
        title,
        url: item.url,
        publishedAt,
        providerScore,
        category: (typeof item.category === "string" && item.category.trim()
          ? item.category
          : categoryForHeadline(title)).toUpperCase()
      };

      if (typeof item.id === "string" && item.id.trim()) article.providerArticleId = item.id.trim().slice(0, 200);
      if (typeof item.summary === "string" && item.summary.trim()) article.summary = cleanPublisherText(item.summary);
      if (typeof item.imageUrl === "string" && item.imageUrl.startsWith("https://")) article.imageUrl = item.imageUrl;
      if (typeof item.publisherName === "string" && item.publisherName.trim()) {
        article.publisherName = cleanPublisherText(item.publisherName).slice(0, 200);
      }
      if (typeof item.publisherDomain === "string" && item.publisherDomain.trim()) {
        article.publisherDomain = item.publisherDomain.trim().toLowerCase();
      }
      const language = toIso639Language(item.sourceLanguage);
      if (language) article.sourceLanguage = language;
      const countryCode = toIso2CountryCode(item.countryCode) ?? query.countryCode;
      if (countryCode) article.countryCode = countryCode;

      results.push(article);
    }

    return results;
  }
}

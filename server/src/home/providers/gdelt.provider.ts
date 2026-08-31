import type { NewsProvider } from "../news-provider.js";
import type { NewsQuery, RawNewsArticle } from "../home.types.js";
import {
  categoryForHeadline,
  cleanPublisherText,
  toIso2CountryCode,
  toIso639Language,
  toIsoTimestamp
} from "../news-normalization.js";

// GDELT topic tokens per Home category. GDELT's `query` grammar has no
// category facet, so a category request becomes a keyword clause. Kept here
// rather than in the router so the router stays provider-agnostic.
const CATEGORY_QUERY_TERMS: Record<string, string> = {
  WORLD: "world",
  POLITICS: "(election OR government OR parliament OR diplomacy)",
  TECHNOLOGY: "(technology OR software OR \"artificial intelligence\")",
  HEALTH: "(health OR hospital OR vaccine)",
  CLIMATE: "(climate OR emissions OR renewable)",
  BUSINESS: "(economy OR markets OR trade)",
  SCIENCE: "(science OR research OR space)",
  SPORTS: "(sports OR championship OR league)",
  GENERAL: "world"
};

type GdeltArticle = {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  socialimage?: unknown;
  domain?: unknown;
  language?: unknown;
  sourcecountry?: unknown;
};

export class GdeltNewsProvider implements NewsProvider {
  readonly name = "GDELT_DOC_2";
  readonly priority = 100;

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  isConfigured(): boolean {
    return process.env.HOME_NEWS_GDELT_ENABLED !== "false";
  }

  private buildQuery(query: NewsQuery): string {
    const clauses: string[] = [];
    if (query.countryCode) clauses.push(`sourcecountry:${query.countryCode.toUpperCase()}`);
    const categories = (query.categories ?? [])
      .map((category) => CATEGORY_QUERY_TERMS[category.toUpperCase()])
      .filter((term): term is string => Boolean(term));
    if (categories.length) clauses.push(categories.length === 1 ? categories[0]! : `(${categories.join(" OR ")})`);
    // A bare `sourcecountry:` filter is rejected by GDELT as having no search
    // terms, so a topical clause is always present.
    if (!categories.length) clauses.push(CATEGORY_QUERY_TERMS.WORLD!);
    return clauses.join(" ");
  }

  async fetch(query: NewsQuery, signal: AbortSignal): Promise<RawNewsArticle[]> {
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", this.buildQuery(query));
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", String(Math.min(Math.max(query.limit, 1), 250)));
    url.searchParams.set("timespan", query.breakingOnly ? "3h" : "24h");
    url.searchParams.set("sort", query.breakingOnly ? "datedesc" : "hybridrel");

    const response = await this.fetcher(url, {
      headers: { accept: "application/json", "user-agent": "LinqaHome/1.1 (+https://linqa.app)" },
      signal,
      redirect: "error"
    });
    if (!response.ok) throw new Error(`GDELT_HTTP_${response.status}`);

    // GDELT answers rate limits and malformed queries with a text/plain body
    // and a 200. Treat that as a provider failure so the circuit breaker sees
    // it, instead of letting JSON.parse throw an opaque SyntaxError.
    const raw = await response.text();
    let body: { articles?: GdeltArticle[] };
    try {
      body = JSON.parse(raw) as { articles?: GdeltArticle[] };
    } catch {
      throw new Error("GDELT_NON_JSON_RESPONSE");
    }

    const articles = Array.isArray(body.articles) ? body.articles : [];
    const results: RawNewsArticle[] = [];

    for (const article of articles) {
      if (typeof article.url !== "string" || typeof article.title !== "string") continue;
      const title = cleanPublisherText(article.title);
      const publishedAt = toIsoTimestamp(article.seendate);
      if (!title || !publishedAt) continue;

      const item: RawNewsArticle = {
        providerName: this.name,
        title,
        url: article.url,
        publishedAt,
        providerScore: 0.7,
        category: (query.categories?.[0] ?? categoryForHeadline(title)).toUpperCase()
      };

      if (typeof article.socialimage === "string" && article.socialimage.startsWith("https://")) {
        item.imageUrl = article.socialimage;
      }
      if (typeof article.domain === "string" && article.domain.trim()) {
        const domain = article.domain.trim().toLowerCase();
        item.publisherDomain = domain;
        item.publisherName = domain;
      }
      const language = toIso639Language(article.language);
      if (language) item.sourceLanguage = language;
      const countryCode = toIso2CountryCode(article.sourcecountry) ?? query.countryCode;
      if (countryCode) item.countryCode = countryCode;

      // The un-normalized provider values are retained for provenance: a
      // publisher dispute or a normalization bug needs the original strings.
      item.metadata = {
        providerRaw: {
          sourcecountry: typeof article.sourcecountry === "string" ? article.sourcecountry : null,
          language: typeof article.language === "string" ? article.language : null,
          seendate: typeof article.seendate === "string" ? article.seendate : null
        }
      };

      results.push(item);
    }

    return results;
  }
}

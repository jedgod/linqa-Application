import { createHash } from "node:crypto";
import { homeProductionConfig } from "../config/home-production.config.js";
import type { HomeNewsItem, RawNewsArticle } from "./home.types.js";
import { PublisherTrustService } from "./publisher-trust.service.js";
import {
  categoryForHeadline,
  cleanPublisherText,
  toIso2CountryCode,
  toIso639Language,
  toIsoTimestamp
} from "./news-normalization.js";

// Query parameters that only exist to attribute the click, never to identify
// the article. Removing them is what makes two providers' copies of the same
// story collapse to one canonical URL.
const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "utm_name", "utm_reader", "utm_brand", "utm_social", "utm_social-type",
  "fbclid", "gclid", "gbraid", "wbraid", "msclkid", "dclid", "twclid", "igshid",
  "mc_cid", "mc_eid", "ref", "ref_src", "referrer", "cmpid", "ito", "at_medium",
  "at_campaign", "smid", "spm", "sh", "s_kwcid", "yclid", "_ga", "_gl"
];

// Hosts that cannot be a real publisher and would either leak internal
// network reachability or produce an unopenable client link.
const FORBIDDEN_HOST_PATTERN =
  /^(localhost|.*\.local|.*\.internal|.*\.localhost|\[?::1\]?|0\.0\.0\.0|169\.254\..*|10\..*|127\..*|192\.168\..*|172\.(1[6-9]|2\d|3[01])\..*)$/i;

const MIN_TITLE_LENGTH = 12;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, "");
}

export class NewsValidationService {
  constructor(private readonly trustService: PublisherTrustService) {}

  /**
   * Turns one provider article into a storable, client-safe Home news item, or
   * throws a stable machine reason. Every throw path is a rejection metric in
   * `linqa_news_articles_rejected_total{reason}` — the reason strings are part
   * of the operational contract, so don't reword them casually.
   */
  async validate(raw: RawNewsArticle): Promise<HomeNewsItem> {
    const title = cleanPublisherText(raw.title ?? "");
    if (title.length < MIN_TITLE_LENGTH || title.length > homeProductionConfig.news.maxTitleLength) {
      throw new Error("INVALID_NEWS_TITLE");
    }

    if (typeof raw.url !== "string" || raw.url.length > homeProductionConfig.news.maxUrlLength) {
      throw new Error("NEWS_URL_TOO_LONG");
    }

    let parsed: URL;
    try {
      parsed = new URL(raw.url);
    } catch {
      throw new Error("INVALID_NEWS_URL");
    }

    if (homeProductionConfig.news.requireHttps && parsed.protocol !== "https:") {
      throw new Error("NEWS_URL_NOT_HTTPS");
    }
    if (parsed.username || parsed.password) throw new Error("NEWS_URL_HAS_CREDENTIALS");
    if (FORBIDDEN_HOST_PATTERN.test(parsed.hostname)) throw new Error("NEWS_URL_HOST_FORBIDDEN");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(parsed.hostname)) throw new Error("NEWS_URL_HOST_NOT_A_DOMAIN");

    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    for (const key of TRACKING_PARAMS) parsed.searchParams.delete(key);
    // `URL.toString()` keeps a bare "?" once every parameter is deleted, which
    // would make the same story hash to two different canonical URLs.
    const canonicalUrl = parsed.toString().replace(/\?$/, "");

    const publisherDomain = normalizeHost(parsed.hostname);
    const providerScore = Math.max(0, Math.min(1, raw.providerScore ?? 0.5));
    const trust = await this.trustService.requireAllowed(publisherDomain, providerScore);

    const publishedAtIso = toIsoTimestamp(raw.publishedAt);
    if (!publishedAtIso) throw new Error("INVALID_NEWS_PUBLISHED_AT");
    const publishedAt = new Date(publishedAtIso);
    // A five-minute grace absorbs publisher clock skew; beyond that the
    // timestamp is not trustworthy enough to rank a feed by.
    if (publishedAt.getTime() > Date.now() + 300_000) throw new Error("NEWS_FUTURE_TIMESTAMP");

    const summary = raw.summary
      ? cleanPublisherText(raw.summary).slice(0, homeProductionConfig.news.maxSummaryLength)
      : undefined;

    // Only HTTPS images reach the client: an http image in an https app is
    // blocked as mixed content and renders as a broken card.
    const imageUrl = typeof raw.imageUrl === "string" && raw.imageUrl.startsWith("https://")
      && raw.imageUrl.length <= homeProductionConfig.news.maxUrlLength
      ? raw.imageUrl
      : undefined;

    const validationScore = Math.min(
      1,
      0.35 +
        providerScore * 0.25 +
        (trust.trustStatus === "TRUSTED" ? 0.3 : trust.trustStatus === "LIMITED" ? 0.15 : 0.05) +
        (summary ? 0.05 : 0) +
        (imageUrl ? 0.05 : 0)
    );

    const category = (raw.category?.trim() || categoryForHeadline(title)).toUpperCase().slice(0, 40);

    const article: HomeNewsItem = {
      providerName: raw.providerName,
      title,
      url: raw.url,
      canonicalUrl,
      urlHash: sha256(canonicalUrl),
      publisherDomain,
      publisherName: (raw.publisherName?.trim() || trust.displayName || publisherDomain).slice(0, 200),
      publishedAt: publishedAt.toISOString(),
      category,
      providerScore,
      validationScore,
      trustScore: trust.trustStatus === "TRUSTED" ? 1 : trust.trustStatus === "LIMITED" ? 0.65 : 0.35,
      // The hour bucket is what makes two providers' independently-worded
      // copies of the same story dedupe: same headline, same publisher, same
      // hour is the same story.
      contentFingerprint: sha256(
        `${title.toLowerCase()}|${publisherDomain}|${publishedAt.toISOString().slice(0, 13)}`
      ),
      publisherTrustStatus: trust.trustStatus,
      attributionRequired: trust.attributionRequired,
      breakingEligible: trust.allowBreaking
    };

    if (summary !== undefined) article.summary = summary;
    if (imageUrl !== undefined) article.imageUrl = imageUrl;
    if (raw.providerArticleId !== undefined) article.providerArticleId = raw.providerArticleId;

    const countryCode = toIso2CountryCode(raw.countryCode);
    if (countryCode !== undefined) article.countryCode = countryCode;
    const sourceLanguage = toIso639Language(raw.sourceLanguage);
    if (sourceLanguage !== undefined) article.sourceLanguage = sourceLanguage;
    if (raw.metadata !== undefined) article.metadata = raw.metadata;

    return article;
  }
}

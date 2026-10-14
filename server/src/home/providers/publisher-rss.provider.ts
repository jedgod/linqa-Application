import { XMLParser } from "fast-xml-parser";
import type { NewsProvider } from "../news-provider.js";
import type { NewsQuery, RawNewsArticle } from "../home.types.js";
import { cleanPublisherText, toIsoTimestamp } from "../news-normalization.js";

/**
 * First-party publisher RSS lane.
 *
 * GDELT is an index *about* coverage; this reads the publishers' own syndication
 * feeds directly. That matters for Home in two ways:
 *
 *  - Attribution is first-party. The link, headline, standfirst and artwork all
 *    come from the publisher's own feed, so what Home renders is what the
 *    publisher published, and `PublisherTrustService` still gates the domain.
 *  - It carries artwork. GDELT's `socialimage` is frequently absent, and Home's
 *    hero and Spotlight are image-led surfaces; an image-less feed renders as a
 *    flat colour card.
 *
 * Only feeds that answer 200 without a redirect are shipped in the default set:
 * `redirect: "error"` is kept from the GDELT lane so a hijacked or misconfigured
 * feed URL cannot walk the fetch onto another host.
 */

export interface RssFeedSource {
  url: string;
  category: string;
  /** ISO-3166 alpha-2 of the *publisher*, mirroring GDELT's `sourcecountry`. */
  countryCode: string;
}

/**
 * Publishers carried by the `home_news_publishers` allowlist
 * (migrations 041 and 043). A feed whose articles resolve to an unlisted domain is
 * rejected downstream by the validator, not here — this list only decides what
 * gets fetched.
 */
export const DEFAULT_RSS_FEEDS: RssFeedSource[] = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", category: "WORLD", countryCode: "GB" },
  { url: "https://feeds.bbci.co.uk/news/technology/rss.xml", category: "TECHNOLOGY", countryCode: "GB" },
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", category: "BUSINESS", countryCode: "GB" },
  { url: "https://feeds.bbci.co.uk/news/health/rss.xml", category: "HEALTH", countryCode: "GB" },
  { url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", category: "SCIENCE", countryCode: "GB" },
  { url: "https://www.theguardian.com/world/rss", category: "WORLD", countryCode: "GB" },
  { url: "https://www.theguardian.com/environment/climate-crisis/rss", category: "CLIMATE", countryCode: "GB" },
  { url: "https://feeds.skynews.com/feeds/rss/world.xml", category: "WORLD", countryCode: "GB" },
  { url: "https://feeds.arstechnica.com/arstechnica/index", category: "TECHNOLOGY", countryCode: "US" },
  { url: "https://moxie.foxnews.com/google-publisher/latest.xml", category: "WORLD", countryCode: "US" },
  { url: "https://www.cbsnews.com/latest/rss/world", category: "WORLD", countryCode: "US" },
  { url: "https://www.abc.net.au/news/feed/51120/rss.xml", category: "WORLD", countryCode: "AU" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", category: "WORLD", countryCode: "US" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", category: "TECHNOLOGY", countryCode: "US" },
  { url: "https://techcrunch.com/feed/", category: "TECHNOLOGY", countryCode: "US" },
  { url: "https://www.theverge.com/rss/index.xml", category: "TECHNOLOGY", countryCode: "US" },
  { url: "https://feeds.npr.org/1004/rss.xml", category: "WORLD", countryCode: "US" },
  { url: "https://feeds.npr.org/1128/rss.xml", category: "HEALTH", countryCode: "US" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", category: "WORLD", countryCode: "QA" },
  { url: 'https://www.pbs.org/newshour/feeds/rss/headlines', category: 'WORLD', countryCode: 'US' },
  { url: 'https://www.lemonde.fr/en/international/rss_full.xml', category: 'WORLD', countryCode: 'FR' },
  { url: 'https://rss.dw.com/rdf/rss-en-all', category: 'WORLD', countryCode: 'DE' }
];

/**
 * `HOME_NEWS_RSS_FEEDS=url|CATEGORY|CC,url|CATEGORY|CC`. Parsed leniently: a
 * malformed entry is skipped rather than taking the whole lane down, because a
 * typo in one feed must not blank Home.
 */
function parseFeedsFromEnv(raw: string): RssFeedSource[] {
  const feeds: RssFeedSource[] = [];
  for (const entry of raw.split(",")) {
    const [url, category, countryCode] = entry.split("|").map((part) => part?.trim() ?? "");
    if (!url || !category || !countryCode) continue;
    try {
      if (new URL(url).protocol !== "https:") continue;
    } catch {
      continue;
    }
    feeds.push({ url, category: category.toUpperCase(), countryCode: countryCode.toUpperCase() });
  }
  return feeds;
}

type XmlNode = Record<string, unknown>;

function asArray(value: unknown): XmlNode[] {
  if (Array.isArray(value)) return value.filter((item): item is XmlNode => typeof item === "object" && item !== null);
  if (value && typeof value === "object") return [value as XmlNode];
  return [];
}

/** RSS keeps text in the node; the parser hands back a string or a `#text`. */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const inner = (value as XmlNode)["#text"];
    if (typeof inner === "string" || typeof inner === "number") return String(inner);
  }
  return "";
}

/**
 * Atom puts the URL in `<link href>`; RSS puts it in the node text. Atom feeds
 * also carry several `rel` variants, and only `alternate` is the article.
 */
function itemLink(item: XmlNode): string {
  const raw = item.link;
  for (const candidate of asArray(raw)) {
    const rel = candidate["@_rel"];
    if (rel === undefined || rel === "alternate") {
      const href = candidate["@_href"];
      if (typeof href === "string" && href.trim()) return href.trim();
    }
  }
  const plain = text(raw);
  if (plain.trim()) return plain.trim();
  const guid = text(item.guid);
  return /^https?:\/\//i.test(guid) ? guid.trim() : "";
}

/**
 * BBC's image CDN encodes the rendered width in the path, and its feeds only
 * ever advertise the 240px thumbnail. Home's hero is a full-bleed card, so the
 * 240 is upgraded along the same documented path rather than rendered blurry.
 * Any other host is left exactly as the publisher supplied it.
 */
const BBC_ICHEF_WIDTH = /^(https:\/\/ichef\.bbci\.co\.uk\/[a-z0-9/]*?\/)(\d{2,4})(\/.+)$/i;
const BBC_TARGET_WIDTH = 1024;

function upgradeKnownThumbnail(url: string): string {
  const match = BBC_ICHEF_WIDTH.exec(url);
  if (!match) return url;
  const current = Number(match[2]);
  if (!Number.isFinite(current) || current >= BBC_TARGET_WIDTH) return url;
  return `${match[1]}${BBC_TARGET_WIDTH}${match[3]}`;
}

/**
 * Picks the largest artwork the item advertises.
 *
 * The Guardian publishes the same photo at several widths, each with its own
 * signature bound to that width — so the widest *offered* variant is chosen
 * rather than rewriting a width parameter, which would invalidate the
 * signature and 403.
 */
function extractImage(item: XmlNode): string | undefined {
  const candidates: Array<{ url: string; width: number }> = [];

  const consider = (node: XmlNode) => {
    const url = node["@_url"];
    if (typeof url !== "string" || !url.startsWith("https://")) return;
    const type = node["@_type"];
    // `enclosure` carries podcasts and video as well as stills.
    if (typeof type === "string" && type && !type.startsWith("image/")) return;
    const width = Number(node["@_width"]);
    candidates.push({ url, width: Number.isFinite(width) ? width : 0 });
  };

  for (const key of ["media:thumbnail", "media:content", "enclosure"]) {
    for (const node of asArray(item[key])) consider(node);
  }

  if (!candidates.length) return undefined;
  candidates.sort((a, b) => b.width - a.width);
  return upgradeKnownThumbnail(candidates[0]!.url);
}

export class PublisherRssProvider implements NewsProvider {
  readonly name = "PUBLISHER_RSS";
  /**
   * Above GDELT. GDELT is a broader index, but these are the publishers'
   * own words and their own artwork, so when both carry a story the
   * first-party copy is the one Home should show.
   */
  readonly priority = 120;

  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    // Headlines like "3 dead" must stay strings, or a numeric-looking title
    // arrives as a number and fails the title-length check.
    parseTagValue: false,
    parseAttributeValue: false
  });

  constructor(
    private readonly feedOverride?: RssFeedSource[],
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private feeds(): RssFeedSource[] {
    if (this.feedOverride) return this.feedOverride;
    const configured = process.env.HOME_NEWS_RSS_FEEDS;
    if (configured) {
      const parsed = parseFeedsFromEnv(configured);
      if (parsed.length) return parsed;
    }
    return DEFAULT_RSS_FEEDS;
  }

  isConfigured(): boolean {
    return process.env.HOME_NEWS_RSS_ENABLED !== "false" && this.feeds().length > 0;
  }

  /**
   * A country-scoped refresh must only return that country's publishers —
   * tagging a London newsroom's story as US coverage because the caller asked
   * for US is exactly the kind of quiet fabrication Home forbids. No feed for
   * the country means no articles, and the caller reports that honestly.
   */
  private selectFeeds(query: NewsQuery): RssFeedSource[] {
    let feeds = this.feeds();
    if (query.countryCode) {
      const wanted = query.countryCode.toUpperCase();
      feeds = feeds.filter((feed) => feed.countryCode === wanted);
    }
    const categories = (query.categories ?? []).map((category) => category.toUpperCase());
    if (categories.length) {
      const matching = feeds.filter((feed) => categories.includes(feed.category));
      // Falling back to the unfiltered set would answer a TECHNOLOGY request
      // with sport, so an unmatched category returns nothing instead.
      feeds = matching;
    }
    return feeds;
  }

  private async fetchFeed(feed: RssFeedSource, signal: AbortSignal): Promise<RawNewsArticle[]> {
    const response = await this.fetcher(feed.url, {
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
        "user-agent": "LinqaHome/1.1 (+https://linqa.app)"
      },
      signal,
      redirect: "error"
    });
    if (!response.ok) throw new Error(`PUBLISHER_RSS_HTTP_${response.status}`);

    const body = await response.text();
    let document: XmlNode;
    try {
      document = this.parser.parse(body) as XmlNode;
    } catch {
      throw new Error("PUBLISHER_RSS_MALFORMED_XML");
    }

    const rss = document.rss as XmlNode | undefined;
    const channel = rss?.channel as XmlNode | undefined;
    const feedRoot = document.feed as XmlNode | undefined;
    const rdf = document['rdf:RDF'] as XmlNode | undefined;
    const items = channel ? asArray(channel.item) : rdf ? asArray(rdf.item) : asArray(feedRoot?.entry);

    const articles: RawNewsArticle[] = [];
    for (const item of items) {
      const title = cleanPublisherText(text(item.title));
      const url = itemLink(item);
      if (!title || !url) continue;

      const publishedAt = toIsoTimestamp(
        text(item.pubDate) || text(item.published) || text(item.updated) || text(item["dc:date"])
      );
      if (!publishedAt) continue;

      const article: RawNewsArticle = {
        providerName: this.name,
        title,
        url,
        publishedAt,
        // Comfortably over the 0.60 floor the seeded publishers require, and
        // above GDELT's 0.70: this is the publisher's own syndication feed,
        // not a third-party guess at what they published.
        providerScore: 0.85,
        category: feed.category,
        countryCode: feed.countryCode
      };

      const summary = cleanPublisherText(text(item.description) || text(item.summary));
      if (summary) article.summary = summary;

      const imageUrl = extractImage(item);
      if (imageUrl) article.imageUrl = imageUrl;

      const guid = text(item.guid) || text(item.id);
      if (guid.trim()) article.providerArticleId = guid.trim().slice(0, 200);

      article.metadata = { providerRaw: { feedUrl: feed.url, feedCategory: feed.category } };
      articles.push(article);
    }
    return articles;
  }

  async fetch(query: NewsQuery, signal: AbortSignal): Promise<RawNewsArticle[]> {
    const feeds = this.selectFeeds(query);
    if (!feeds.length) return [];

    // One slow or broken feed must not cost the whole lane, so every feed is
    // settled independently and failures contribute nothing.
    const settled = await Promise.allSettled(feeds.map((feed) => this.fetchFeed(feed, signal)));

    const collected: RawNewsArticle[] = [];
    let failures = 0;
    for (const result of settled) {
      if (result.status === "fulfilled") collected.push(...result.value);
      else failures += 1;
    }

    // Every feed failing is a lane failure, not an empty world: surfacing it
    // lets the router open the circuit and mark the feed STALE rather than
    // reporting "no news" as though that were the truth.
    if (failures === settled.length) throw new Error("PUBLISHER_RSS_ALL_FEEDS_FAILED");

    // Newest first, then trimmed: with a dozen feeds the raw union easily
    // exceeds the request limit, and the caller wants the freshest slice.
    collected.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    return collected.slice(0, Math.max(query.limit, 1));
  }
}

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RSS_FEEDS,
  PublisherRssProvider,
  type RssFeedSource
} from "../../home/providers/publisher-rss.provider.js";

const FEED: RssFeedSource = { url: "https://feeds.example.com/world", category: "WORLD", countryCode: "GB" };

function rss(items: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
     <rss xmlns:media="http://search.yahoo.com/mrss/" version="2.0"><channel>${items}</channel></rss>`,
    { status: 200, headers: { "content-type": "application/rss+xml" } }
  );
}

const ITEM = `
  <item>
    <title><![CDATA[Rescuers reach trapped hydropower workers after four days]]></title>
    <description><![CDATA[Crews used explosives to open a path to the shaft.]]></description>
    <link>https://www.bbc.co.uk/news/articles/abc123?at_medium=RSS&amp;at_campaign=rss</link>
    <guid isPermaLink="false">https://www.bbc.co.uk/news/articles/abc123#0</guid>
    <pubDate>Mon, 31 Aug 2026 17:30:47 GMT</pubDate>
    <media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/x/live/y.jpg"/>
  </item>`;

afterEach(() => {
  delete process.env.HOME_NEWS_RSS_ENABLED;
  delete process.env.HOME_NEWS_RSS_FEEDS;
});

describe("publisher RSS provider: parsing", () => {
  it("maps an RSS item into a storable article", async () => {
    const fetcher = vi.fn(async () => rss(ITEM));
    const provider = new PublisherRssProvider([FEED], fetcher as unknown as typeof fetch);

    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);

    expect(article).toBeDefined();
    expect(article!.title).toBe("Rescuers reach trapped hydropower workers after four days");
    expect(article!.summary).toBe("Crews used explosives to open a path to the shaft.");
    // The RFC-822 pubDate has to reach the validator as ISO.
    expect(article!.publishedAt).toBe("2026-08-31T17:30:47.000Z");
    expect(article!.providerName).toBe("PUBLISHER_RSS");
    expect(article!.category).toBe("WORLD");
    expect(article!.countryCode).toBe("GB");
    // The XML entity in the link must be decoded, or the URL carries a literal
    // "&amp;" and canonicalisation produces a different hash than the same
    // story from another lane.
    expect(article!.url).toContain("at_medium=RSS&at_campaign=rss");
  });

  it("scores above the seeded publishers' minimum so real feeds are not filtered out", async () => {
    const fetcher = vi.fn(async () => rss(ITEM));
    const provider = new PublisherRssProvider([FEED], fetcher as unknown as typeof fetch);
    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);
    // Migration 041 seeds min_provider_score 0.60.
    expect(article!.providerScore).toBeGreaterThan(0.6);
  });

  it("reads Atom entries, where the URL is an attribute and not node text", async () => {
    const atom = new Response(
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
         <entry>
           <title>Ars reviews the new silicon and finds it wanting</title>
           <link rel="replies" href="https://arstechnica.com/comments/1"/>
           <link rel="alternate" href="https://arstechnica.com/story-1"/>
           <published>2026-08-31T12:00:00Z</published>
           <summary>A long look at the benchmarks.</summary>
         </entry>
       </feed>`,
      { status: 200 }
    );
    const provider = new PublisherRssProvider(
      [{ url: "https://feeds.example.com/tech", category: "TECHNOLOGY", countryCode: "US" }],
      (async () => atom) as unknown as typeof fetch
    );

    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);

    // `rel="replies"` is a comments thread, not the article.
    expect(article!.url).toBe("https://arstechnica.com/story-1");
    expect(article!.category).toBe("TECHNOLOGY");
  });

  it("keeps a numeric-looking headline a string", async () => {
    const fetcher = vi.fn(async () => rss(ITEM.replace(/<!\[CDATA\[.*?\]\]>/, "2026")));
    const provider = new PublisherRssProvider([FEED], fetcher as unknown as typeof fetch);

    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);

    // `parseTagValue: false` is load-bearing: without it the parser hands back
    // the number 2026 and `cleanPublisherText` throws on `.replace`, taking the
    // whole feed down over one headline. Rejecting a too-short title is the
    // validator's job, not this lane's.
    expect(typeof article!.title).toBe("string");
    expect(article!.title).toBe("2026");
  });

  it("skips items with no link or no parseable date rather than failing the feed", async () => {
    const fetcher = vi.fn(async () =>
      rss(`
        ${ITEM}
        <item><title>A headline with no link at all here</title><pubDate>Mon, 31 Aug 2026 17:30:47 GMT</pubDate></item>
        <item><title>A headline with no date at all here</title><link>https://bbc.co.uk/x</link></item>`)
    );
    const provider = new PublisherRssProvider([FEED], fetcher as unknown as typeof fetch);
    const articles = await provider.fetch({ limit: 10 }, new AbortController().signal);
    expect(articles).toHaveLength(1);
  });
});

describe("publisher RSS provider: artwork", () => {
  it("upgrades the BBC thumbnail to a hero-sized render", async () => {
    const fetcher = vi.fn(async () => rss(ITEM));
    const provider = new PublisherRssProvider([FEED], fetcher as unknown as typeof fetch);
    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);
    // The feed only ever advertises 240px; Home's hero is full-bleed.
    expect(article!.imageUrl).toBe("https://ichef.bbci.co.uk/ace/standard/1024/cpsprodpb/x/live/y.jpg");
  });

  it("takes the widest offered variant rather than rewriting a signed width", async () => {
    const guardian = `
      <item>
        <title>Guardian publishes the same photo at several widths</title>
        <link>https://www.theguardian.com/world/story</link>
        <pubDate>Mon, 31 Aug 2026 17:30:47 GMT</pubDate>
        <media:content width="140" url="https://i.guim.co.uk/img/a.jpg?width=140&amp;s=sig140"/>
        <media:content width="460" url="https://i.guim.co.uk/img/a.jpg?width=460&amp;s=sig460"/>
      </item>`;
    const provider = new PublisherRssProvider([FEED], (async () => rss(guardian)) as unknown as typeof fetch);
    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);
    // Rewriting the width would invalidate the signature bound to it.
    expect(article!.imageUrl).toBe("https://i.guim.co.uk/img/a.jpg?width=460&s=sig460");
  });

  it("ignores non-image enclosures and http artwork", async () => {
    const mixed = `
      <item>
        <title>An article whose enclosure is an audio file</title>
        <link>https://www.npr.org/story</link>
        <pubDate>Mon, 31 Aug 2026 17:30:47 GMT</pubDate>
        <enclosure url="https://npr.org/audio.mp3" type="audio/mpeg"/>
        <media:thumbnail url="http://npr.org/insecure.jpg"/>
      </item>`;
    const provider = new PublisherRssProvider([FEED], (async () => rss(mixed)) as unknown as typeof fetch);
    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);
    // An http image is blocked as mixed content and renders as a broken card.
    expect(article!.imageUrl).toBeUndefined();
  });
});

describe("publisher RSS provider: feed selection", () => {
  it("returns only the requested country's publishers", async () => {
    const feeds: RssFeedSource[] = [
      { url: "https://feeds.example.com/gb", category: "WORLD", countryCode: "GB" },
      { url: "https://feeds.example.com/us", category: "WORLD", countryCode: "US" }
    ];
    const fetcher = vi.fn(async () => rss(ITEM));
    const provider = new PublisherRssProvider(feeds, fetcher as unknown as typeof fetch);

    await provider.fetch({ limit: 10, countryCode: "US" }, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain("/us");
  });

  it("returns nothing for a country it has no publisher for, rather than mislabelling one", async () => {
    const fetcher = vi.fn(async () => rss(ITEM));
    const provider = new PublisherRssProvider([FEED], fetcher as unknown as typeof fetch);

    const articles = await provider.fetch({ limit: 10, countryCode: "KE" }, new AbortController().signal);

    expect(articles).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("answers a category request only from feeds of that category", async () => {
    const feeds: RssFeedSource[] = [
      { url: "https://feeds.example.com/world", category: "WORLD", countryCode: "GB" },
      { url: "https://feeds.example.com/tech", category: "TECHNOLOGY", countryCode: "GB" }
    ];
    const fetcher = vi.fn(async () => rss(ITEM));
    const provider = new PublisherRssProvider(feeds, fetcher as unknown as typeof fetch);

    await provider.fetch({ limit: 10, categories: ["TECHNOLOGY"] }, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain("/tech");
  });
});

describe("publisher RSS provider: resilience", () => {
  it("keeps the healthy feeds when one fails", async () => {
    const feeds: RssFeedSource[] = [
      { url: "https://feeds.example.com/bad", category: "WORLD", countryCode: "GB" },
      { url: "https://feeds.example.com/good", category: "WORLD", countryCode: "GB" }
    ];
    const fetcher = vi.fn(async (input: unknown) =>
      String(input).includes("/bad") ? new Response("nope", { status: 500 }) : rss(ITEM)
    );
    const provider = new PublisherRssProvider(feeds, fetcher as unknown as typeof fetch);

    const articles = await provider.fetch({ limit: 10 }, new AbortController().signal);
    expect(articles).toHaveLength(1);
  });

  it("throws when every feed fails, so the router can open the circuit", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 503 }));
    const provider = new PublisherRssProvider([FEED], fetcher as unknown as typeof fetch);

    // Returning [] here would report a provider outage as "no news in the
    // world", which is the one thing Home must never say.
    await expect(provider.fetch({ limit: 10 }, new AbortController().signal)).rejects.toThrow(
      "PUBLISHER_RSS_ALL_FEEDS_FAILED"
    );
  });

  it("survives a feed that is not XML at all", async () => {
    const fetcher = vi.fn(async () => new Response("<html>error page</html>", { status: 200 }));
    const provider = new PublisherRssProvider([FEED], fetcher as unknown as typeof fetch);
    const articles = await provider.fetch({ limit: 10 }, new AbortController().signal);
    expect(articles).toEqual([]);
  });

  it("returns the freshest slice when the union exceeds the limit", async () => {
    const many = Array.from({ length: 5 }, (_unused, i) =>
      `<item><title>Headline number ${i} from the wire</title>
         <link>https://bbc.co.uk/${i}</link>
         <pubDate>Mon, 31 Aug 2026 1${i}:00:00 GMT</pubDate></item>`
    ).join("");
    const provider = new PublisherRssProvider([FEED], (async () => rss(many)) as unknown as typeof fetch);

    const articles = await provider.fetch({ limit: 2 }, new AbortController().signal);

    expect(articles).toHaveLength(2);
    expect(articles[0]!.title).toContain("number 4");
    expect(articles[1]!.title).toContain("number 3");
  });
});

describe("publisher RSS provider: configuration", () => {
  it("is disabled by an explicit opt-out", () => {
    process.env.HOME_NEWS_RSS_ENABLED = "false";
    expect(new PublisherRssProvider().isConfigured()).toBe(false);
  });

  it("ships a default feed set so the lane works with no configuration", () => {
    expect(new PublisherRssProvider().isConfigured()).toBe(true);
    expect(DEFAULT_RSS_FEEDS.length).toBeGreaterThan(0);
    // Every default must be HTTPS: `redirect: "error"` plus an http feed would
    // be a plaintext fetch that silently yields nothing.
    for (const feed of DEFAULT_RSS_FEEDS) {
      expect(new URL(feed.url).protocol).toBe("https:");
    }
    expect(DEFAULT_RSS_FEEDS.map((feed) => feed.url)).toEqual(
      expect.arrayContaining([
        "https://moxie.foxnews.com/google-publisher/latest.xml",
        "https://www.abc.net.au/news/feed/51120/rss.xml",
        "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
        "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
        "https://techcrunch.com/feed/",
        "https://www.theverge.com/rss/index.xml"
      ])
    );
  });

  it("reads an operator-supplied feed list and skips malformed entries", async () => {
    process.env.HOME_NEWS_RSS_FEEDS =
      "https://ops.example.com/a|WORLD|GB,not-a-url|WORLD|GB,http://insecure.example.com/b|WORLD|GB,missing-fields";
    const fetcher = vi.fn(async () => rss(ITEM));
    const provider = new PublisherRssProvider(undefined, fetcher as unknown as typeof fetch);

    await provider.fetch({ limit: 10 }, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe("https://ops.example.com/a");
  });
});

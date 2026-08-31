import { afterEach, describe, expect, it, vi } from "vitest";
import { GdeltNewsProvider } from "../../home/providers/gdelt.provider.js";
import { ApprovedSecondaryProvider } from "../../home/providers/secondary.provider.js";

const GDELT_ARTICLE = {
  url: "https://reuters.com/markets/story",
  title: "Central bank holds rates &amp; signals patience",
  seendate: "20260829T101500Z",
  socialimage: "https://images.reuters.com/story.jpg",
  domain: "reuters.com",
  language: "English",
  sourcecountry: "United Kingdom"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  delete process.env.HOME_NEWS_GDELT_ENABLED;
  delete process.env.HOME_APPROVED_RSS_ENDPOINT;
  delete process.env.HOME_APPROVED_RSS_TOKEN;
});

describe("GDELT provider", () => {
  it("normalizes an article into a storable shape", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ articles: [GDELT_ARTICLE] }));
    const provider = new GdeltNewsProvider(fetcher as unknown as typeof fetch);

    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);

    expect(article).toBeDefined();
    expect(article!.title).toBe("Central bank holds rates & signals patience");
    // The compact GDELT date has to become ISO here, or validation rejects it.
    expect(article!.publishedAt).toBe("2026-08-29T10:15:00.000Z");
    expect(article!.countryCode).toBe("GB");
    expect(article!.sourceLanguage).toBe("en");
    expect(article!.publisherDomain).toBe("reuters.com");
    expect(article!.providerName).toBe("GDELT_DOC_2");
  });

  it("preserves the provider's raw values for provenance", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ articles: [GDELT_ARTICLE] }));
    const provider = new GdeltNewsProvider(fetcher as unknown as typeof fetch);

    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);
    const raw = (article!.metadata as { providerRaw: Record<string, unknown> }).providerRaw;

    expect(raw.sourcecountry).toBe("United Kingdom");
    expect(raw.seendate).toBe("20260829T101500Z");
  });

  it("skips articles missing a url, title or date instead of failing the batch", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        articles: [
          GDELT_ARTICLE,
          { url: "https://reuters.com/a", seendate: "20260829T101500Z" },
          { title: "No url here", seendate: "20260829T101500Z" },
          { url: "https://reuters.com/b", title: "No date here" },
          { url: "https://reuters.com/c", title: "Bad date here", seendate: "nonsense" }
        ]
      })
    );
    const provider = new GdeltNewsProvider(fetcher as unknown as typeof fetch);

    const articles = await provider.fetch({ limit: 10 }, new AbortController().signal);

    expect(articles).toHaveLength(1);
  });

  it("drops a non-HTTPS social image", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ articles: [{ ...GDELT_ARTICLE, socialimage: "http://images.reuters.com/a.jpg" }] })
    );
    const provider = new GdeltNewsProvider(fetcher as unknown as typeof fetch);

    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);
    expect(article!.imageUrl).toBeUndefined();
  });

  it("raises a labelled error on an HTTP failure so the breaker can see it", async () => {
    const fetcher = vi.fn(async () => new Response("upstream error", { status: 503 }));
    const provider = new GdeltNewsProvider(fetcher as unknown as typeof fetch);

    await expect(provider.fetch({ limit: 10 }, new AbortController().signal))
      .rejects.toThrow("GDELT_HTTP_503");
  });

  it("treats a 200 with a non-JSON body as a provider failure", async () => {
    // GDELT answers rate limits and bad queries with text/plain and a 200.
    const fetcher = vi.fn(async () => new Response("rate limit exceeded", { status: 200 }));
    const provider = new GdeltNewsProvider(fetcher as unknown as typeof fetch);

    await expect(provider.fetch({ limit: 10 }, new AbortController().signal))
      .rejects.toThrow("GDELT_NON_JSON_RESPONSE");
  });

  it("always includes a topical clause, because a bare country filter is rejected", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ articles: [] }));
    const provider = new GdeltNewsProvider(fetcher as unknown as typeof fetch);

    await provider.fetch({ limit: 10, countryCode: "gb" }, new AbortController().signal);

    const requested = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    const query = requested.searchParams.get("query") ?? "";
    expect(query).toContain("sourcecountry:GB");
    expect(query.replace("sourcecountry:GB", "").trim().length).toBeGreaterThan(0);
  });

  it("translates a Home category into GDELT search terms", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ articles: [] }));
    const provider = new GdeltNewsProvider(fetcher as unknown as typeof fetch);

    await provider.fetch({ limit: 10, categories: ["HEALTH"] }, new AbortController().signal);

    const requested = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    expect(requested.searchParams.get("query")).toContain("health");
  });

  it("narrows the window and sorts by date for a breaking request", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ articles: [] }));
    const provider = new GdeltNewsProvider(fetcher as unknown as typeof fetch);

    await provider.fetch({ limit: 10, breakingOnly: true }, new AbortController().signal);

    const requested = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    expect(requested.searchParams.get("timespan")).toBe("3h");
    expect(requested.searchParams.get("sort")).toBe("datedesc");
  });

  it("is configured unless explicitly disabled", () => {
    const provider = new GdeltNewsProvider();
    expect(provider.isConfigured()).toBe(true);
    process.env.HOME_NEWS_GDELT_ENABLED = "false";
    expect(provider.isConfigured()).toBe(false);
  });
});

describe("approved secondary provider", () => {
  it("is unconfigured with no endpoint", () => {
    expect(new ApprovedSecondaryProvider().isConfigured()).toBe(false);
  });

  it("refuses a non-HTTPS endpoint", () => {
    expect(new ApprovedSecondaryProvider("http://feeds.example/news").isConfigured()).toBe(false);
  });

  it("refuses a malformed endpoint", () => {
    expect(new ApprovedSecondaryProvider("not a url").isConfigured()).toBe(false);
  });

  it("accepts an HTTPS endpoint from the environment", () => {
    process.env.HOME_APPROVED_RSS_ENDPOINT = "https://feeds.example/news";
    expect(new ApprovedSecondaryProvider().isConfigured()).toBe(true);
  });

  it("normalizes items the same way as the primary provider", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "abc",
            title: "Regional summit concludes",
            url: "https://apnews.com/story",
            summary: "<p>Delegates agreed &amp; signed</p>",
            imageUrl: "https://images.apnews.com/a.jpg",
            publishedAt: "2026-08-29T10:15:00Z",
            countryCode: "Kenya",
            sourceLanguage: "English",
            providerScore: 0.92
          }
        ]
      })
    );
    const provider = new ApprovedSecondaryProvider("https://feeds.example/news", fetcher as unknown as typeof fetch);

    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);

    expect(article!.providerName).toBe("APPROVED_RSS");
    expect(article!.providerArticleId).toBe("abc");
    expect(article!.summary).toBe("Delegates agreed & signed");
    expect(article!.countryCode).toBe("KE");
    expect(article!.sourceLanguage).toBe("en");
    expect(article!.providerScore).toBe(0.92);
  });

  it("clamps an out-of-range provider score", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        items: [{ title: "Story with silly score", url: "https://apnews.com/a", publishedAt: "2026-08-29T10:15:00Z", providerScore: 42 }]
      })
    );
    const provider = new ApprovedSecondaryProvider("https://feeds.example/news", fetcher as unknown as typeof fetch);

    const [article] = await provider.fetch({ limit: 10 }, new AbortController().signal);
    expect(article!.providerScore).toBe(1);
  });

  it("forwards the query as endpoint parameters", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ items: [] }));
    const provider = new ApprovedSecondaryProvider("https://feeds.example/news", fetcher as unknown as typeof fetch);

    await provider.fetch({ limit: 7, countryCode: "KE", categories: ["HEALTH"], breakingOnly: true }, new AbortController().signal);

    const requested = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    expect(requested.searchParams.get("country")).toBe("KE");
    expect(requested.searchParams.get("categories")).toBe("HEALTH");
    expect(requested.searchParams.get("limit")).toBe("7");
    expect(requested.searchParams.get("breaking")).toBe("true");
  });

  it("sends a bearer token when one is configured", async () => {
    process.env.HOME_APPROVED_RSS_TOKEN = "secret-token";
    const fetcher = vi.fn(async () => jsonResponse({ items: [] }));
    const provider = new ApprovedSecondaryProvider("https://feeds.example/news", fetcher as unknown as typeof fetch);

    await provider.fetch({ limit: 10 }, new AbortController().signal);

    const init = (fetcher.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(init.headers.authorization).toBe("Bearer secret-token");
  });

  it("raises a labelled error on an HTTP failure", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 500 }));
    const provider = new ApprovedSecondaryProvider("https://feeds.example/news", fetcher as unknown as typeof fetch);

    await expect(provider.fetch({ limit: 10 }, new AbortController().signal))
      .rejects.toThrow("APPROVED_RSS_HTTP_500");
  });

  it("returns nothing rather than throwing when unconfigured", async () => {
    const provider = new ApprovedSecondaryProvider();
    await expect(provider.fetch({ limit: 10 }, new AbortController().signal)).resolves.toEqual([]);
  });
});

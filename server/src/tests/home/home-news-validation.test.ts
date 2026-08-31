import { describe, expect, it, vi } from "vitest";
import { NewsValidationService } from "../../home/news-validation.service.js";
import { PublisherTrustService } from "../../home/publisher-trust.service.js";
import type { PublisherTrustRepository } from "../../home/publisher-trust.repository.js";
import type { RawNewsArticle } from "../../home/home.types.js";

type PublisherRow = {
  canonical_domain: string;
  display_name: string;
  trust_status: string;
  min_provider_score: number;
  allow_breaking: boolean;
  allow_external_links: boolean;
  attribution_required: boolean;
};

function publisher(overrides: Partial<PublisherRow> & { canonical_domain: string }): PublisherRow {
  return {
    display_name: overrides.canonical_domain,
    trust_status: "TRUSTED",
    min_provider_score: 0.6,
    allow_breaking: false,
    allow_external_links: true,
    attribution_required: true,
    ...overrides
  };
}

const ALLOWLIST: PublisherRow[] = [
  publisher({ canonical_domain: "reuters.com", display_name: "Reuters", allow_breaking: true }),
  publisher({ canonical_domain: "analysis.example", display_name: "Analysis Weekly", trust_status: "LIMITED", min_provider_score: 0.65 }),
  publisher({ canonical_domain: "blocked.example", display_name: "Blocked Publisher", trust_status: "BLOCKED", min_provider_score: 1 }),
  publisher({ canonical_domain: "nolinks.example", display_name: "No Links", allow_external_links: false }),
  publisher({ canonical_domain: "strict.example", display_name: "Strict Publisher", min_provider_score: 0.95 })
];

function buildValidator() {
  const repo = {
    findByDomain: vi.fn(async (domain: string) => ALLOWLIST.find((row) => row.canonical_domain === domain) ?? null)
  } as unknown as PublisherTrustRepository;
  return {
    repo,
    validator: new NewsValidationService(new PublisherTrustService(repo))
  };
}

function article(overrides: Partial<RawNewsArticle> = {}): RawNewsArticle {
  return {
    providerName: "TEST",
    title: "Central bank holds rates steady",
    url: "https://reuters.com/markets/story",
    publishedAt: new Date().toISOString(),
    providerScore: 0.7,
    ...overrides
  };
}

describe("home news validation: transport and link safety", () => {
  it("rejects a non-HTTPS link", async () => {
    const { validator } = buildValidator();
    await expect(validator.validate(article({ url: "http://reuters.com/markets/story" })))
      .rejects.toThrow("NEWS_URL_NOT_HTTPS");
  });

  it("rejects a URL carrying embedded credentials", async () => {
    const { validator } = buildValidator();
    await expect(validator.validate(article({ url: "https://user:pass@reuters.com/story" })))
      .rejects.toThrow("NEWS_URL_HAS_CREDENTIALS");
  });

  it("rejects internal and loopback hosts", async () => {
    const { validator } = buildValidator();
    for (const url of [
      "https://localhost/story",
      "https://127.0.0.1/story",
      "https://10.1.2.3/story",
      "https://192.168.1.10/story",
      "https://metadata.internal/story"
    ]) {
      await expect(validator.validate(article({ url })), url).rejects.toThrow(
        /NEWS_URL_HOST_FORBIDDEN|NEWS_URL_HOST_NOT_A_DOMAIN/
      );
    }
  });

  it("rejects a URL longer than the configured maximum", async () => {
    const { validator } = buildValidator();
    const url = `https://reuters.com/${"a".repeat(2_100)}`;
    await expect(validator.validate(article({ url }))).rejects.toThrow("NEWS_URL_TOO_LONG");
  });

  it("rejects malformed URLs", async () => {
    const { validator } = buildValidator();
    await expect(validator.validate(article({ url: "not-a-url" }))).rejects.toThrow("INVALID_NEWS_URL");
  });
});

describe("home news validation: publisher trust", () => {
  it("rejects a blocked publisher", async () => {
    const { validator } = buildValidator();
    await expect(validator.validate(article({ url: "https://blocked.example/story" })))
      .rejects.toThrow("PUBLISHER_BLOCKED");
  });

  it("rejects a publisher whose external links are disabled", async () => {
    const { validator } = buildValidator();
    await expect(validator.validate(article({ url: "https://nolinks.example/story" })))
      .rejects.toThrow("PUBLISHER_LINKS_DISABLED");
  });

  it("rejects a listed publisher below its own provider-score floor", async () => {
    const { validator } = buildValidator();
    await expect(validator.validate(article({ url: "https://strict.example/story", providerScore: 0.7 })))
      .rejects.toThrow("PUBLISHER_PROVIDER_SCORE_TOO_LOW");
  });

  it("rejects an unlisted publisher below the unknown-publisher threshold", async () => {
    const { validator } = buildValidator();
    await expect(validator.validate(article({ url: "https://random-blog.example/story", providerScore: 0.7 })))
      .rejects.toThrow("UNKNOWN_PUBLISHER_SCORE_TOO_LOW");
  });

  it("treats www. as the same publisher as the bare domain", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(article({ url: "https://www.reuters.com/markets/story" }));
    expect(result.publisherDomain).toBe("reuters.com");
    expect(result.publisherTrustStatus).toBe("TRUSTED");
  });

  it("carries the publisher's breaking clearance onto the article", async () => {
    const { validator } = buildValidator();
    const wire = await validator.validate(article());
    const weekly = await validator.validate(
      article({ url: "https://analysis.example/story", providerScore: 0.7 })
    );
    expect(wire.breakingEligible).toBe(true);
    expect(weekly.breakingEligible).toBe(false);
  });

  it("always marks attribution as required", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(article());
    expect(result.attributionRequired).toBe(true);
    expect(result.publisherName).toBe("Reuters");
  });
});

describe("home news validation: canonicalization and dedupe", () => {
  it("strips tracking parameters and the leftover bare question mark", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(
      article({ url: "https://reuters.com/markets/story?utm_source=x&fbclid=y&gclid=z" })
    );
    expect(result.canonicalUrl).toBe("https://reuters.com/markets/story");
    expect(result.canonicalUrl).not.toContain("utm_source");
    expect(result.canonicalUrl).not.toContain("?");
  });

  it("keeps genuine query parameters that identify the article", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(article({ url: "https://reuters.com/story?id=4821" }));
    expect(result.canonicalUrl).toContain("id=4821");
  });

  it("drops the fragment", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(article({ url: "https://reuters.com/story#comments" }));
    expect(result.canonicalUrl).toBe("https://reuters.com/story");
  });

  it("gives two copies of the same story the same fingerprint", async () => {
    const { validator } = buildValidator();
    const publishedAt = new Date("2026-08-29T10:15:00Z").toISOString();
    const first = await validator.validate(
      article({ url: "https://reuters.com/a?utm_source=one", publishedAt })
    );
    const second = await validator.validate(
      article({ url: "https://www.reuters.com/b?utm_campaign=two", publishedAt: "2026-08-29T10:52:00Z" })
    );
    // Same headline, same publisher, same hour bucket -- one story.
    expect(second.contentFingerprint).toBe(first.contentFingerprint);
  });

  it("gives genuinely different stories different fingerprints", async () => {
    const { validator } = buildValidator();
    const first = await validator.validate(article());
    const second = await validator.validate(article({ title: "Central bank cuts rates sharply" }));
    expect(second.contentFingerprint).not.toBe(first.contentFingerprint);
  });

  it("derives urlHash from the canonical URL, not the raw one", async () => {
    const { validator } = buildValidator();
    const withTracking = await validator.validate(article({ url: "https://reuters.com/x?utm_source=a" }));
    const without = await validator.validate(article({ url: "https://reuters.com/x" }));
    expect(withTracking.urlHash).toBe(without.urlHash);
  });
});

describe("home news validation: content shape", () => {
  it("rejects an empty or absurdly short title", async () => {
    const { validator } = buildValidator();
    await expect(validator.validate(article({ title: "" }))).rejects.toThrow("INVALID_NEWS_TITLE");
    await expect(validator.validate(article({ title: "Hi" }))).rejects.toThrow("INVALID_NEWS_TITLE");
  });

  it("rejects an over-long title", async () => {
    const { validator } = buildValidator();
    await expect(validator.validate(article({ title: "A".repeat(200) })))
      .rejects.toThrow("INVALID_NEWS_TITLE");
  });

  it("rejects a future timestamp beyond the clock-skew grace", async () => {
    const { validator } = buildValidator();
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    await expect(validator.validate(article({ publishedAt: future })))
      .rejects.toThrow("NEWS_FUTURE_TIMESTAMP");
  });

  it("accepts a timestamp inside the clock-skew grace", async () => {
    const { validator } = buildValidator();
    const skewed = new Date(Date.now() + 60_000).toISOString();
    await expect(validator.validate(article({ publishedAt: skewed }))).resolves.toBeTruthy();
  });

  it("drops a non-HTTPS image rather than serving mixed content", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(article({ imageUrl: "http://images.example/a.jpg" }));
    expect(result.imageUrl).toBeUndefined();
  });

  it("keeps an HTTPS image", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(article({ imageUrl: "https://images.example/a.jpg" }));
    expect(result.imageUrl).toBe("https://images.example/a.jpg");
  });

  it("strips markup out of titles and summaries", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(
      article({ title: "<b>Central bank</b> holds rates", summary: "<p>Policy unchanged &amp; watched</p>" })
    );
    expect(result.title).toBe("Central bank holds rates");
    expect(result.summary).toBe("Policy unchanged & watched");
  });

  it("normalizes provider country names and languages into codes", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(
      article({ countryCode: "United Kingdom", sourceLanguage: "English" })
    );
    expect(result.countryCode).toBe("GB");
    expect(result.sourceLanguage).toBe("en");
  });

  it("omits an unresolvable country instead of storing a bad one", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(article({ countryCode: "Somewhere Else" }));
    expect(result.countryCode).toBeUndefined();
  });
});

describe("home news validation: scoring", () => {
  it("scores a trusted publisher above the router's 0.65 floor", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(article());
    expect(result.validationScore).toBeGreaterThanOrEqual(0.65);
    expect(result.trustScore).toBe(1);
  });

  it("scores a LIMITED publisher lower than a TRUSTED one", async () => {
    const { validator } = buildValidator();
    const trusted = await validator.validate(article());
    const limited = await validator.validate(
      article({ url: "https://analysis.example/story", providerScore: 0.7 })
    );
    expect(limited.validationScore).toBeLessThan(trusted.validationScore);
    expect(limited.trustScore).toBe(0.65);
  });

  it("clamps a provider score reported outside 0..1", async () => {
    const { validator } = buildValidator();
    const high = await validator.validate(article({ providerScore: 9 }));
    expect(high.providerScore).toBe(1);
    expect(high.validationScore).toBeLessThanOrEqual(1);
  });

  it("never exceeds 1", async () => {
    const { validator } = buildValidator();
    const result = await validator.validate(
      article({ providerScore: 1, summary: "A summary", imageUrl: "https://images.example/a.jpg" })
    );
    expect(result.validationScore).toBeLessThanOrEqual(1);
  });
});

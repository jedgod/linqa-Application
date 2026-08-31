import { describe, expect, it, vi } from "vitest";
import { HomeRepository } from "../../home/home.repository.js";
import type { Database } from "../../db/pool.js";
import type { HomeNewsItem } from "../../home/home.types.js";

function recorder(rows: unknown[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    })
  } as unknown as Database;
  return { db, calls };
}

function article(overrides: Partial<HomeNewsItem> = {}): HomeNewsItem {
  return {
    providerName: "GDELT_DOC_2",
    title: "Central bank holds rates steady",
    url: "https://reuters.com/story?utm_source=x",
    canonicalUrl: "https://reuters.com/story",
    urlHash: "d".repeat(64),
    publisherDomain: "reuters.com",
    publisherName: "Reuters",
    publishedAt: "2026-08-30T10:00:00.000Z",
    category: "BUSINESS",
    providerScore: 0.7,
    validationScore: 0.9,
    trustScore: 1,
    contentFingerprint: "e".repeat(64),
    publisherTrustStatus: "TRUSTED",
    attributionRequired: true,
    breakingEligible: true,
    ...overrides
  };
}

describe("home repository: article persistence", () => {
  it("sets a bounded breaking window from publication for a cleared publisher", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).saveArticle(article());

    const breakingUntil = calls[0]?.params[13] as string;
    // 90-minute default window, measured from published_at rather than now, so
    // a late-arriving story cannot present as newer than it is.
    expect(breakingUntil).toBe("2026-08-30T11:30:00.000Z");
  });

  it("stores no breaking window for a publisher without clearance", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).saveArticle(article({ breakingEligible: false }));
    expect(calls[0]?.params[13]).toBeNull();
  });

  it("records the trust facts in metadata for later audit", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).saveArticle(article({ publisherTrustStatus: "LIMITED" }));

    const metadata = JSON.parse(String(calls[0]?.params[18])) as Record<string, unknown>;
    expect(metadata.publisherTrustStatus).toBe("LIMITED");
    expect(metadata.attributionRequired).toBe(true);
    expect(metadata.sourceUrl).toBe("https://reuters.com/story?utm_source=x");
  });

  it("upserts on canonical URL so re-ingesting a story does not duplicate it", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).saveArticle(article());
    expect(calls[0]?.sql).toContain("ON CONFLICT (canonical_url) DO UPDATE");
  });

  it("revives an expired or previously rejected article when it reappears", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).saveArticle(article());
    // Reaching saveArticle means the article passed validation and publisher
    // trust now, so a REJECTED left behind by an earlier block must not pin
    // the article out of the feed after the publisher is re-approved.
    expect(calls[0]?.sql).toContain(
      "WHEN home_news_articles.lifecycle_state IN ('EXPIRED','REJECTED') THEN 'PUBLISHED'"
    );
  });

  it("stores an absent country as NULL, never as a padded string", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).saveArticle(article());
    expect(calls[0]?.params[10]).toBeNull();
  });
});

describe("home repository: durable-store reads", () => {
  it("only reads live lifecycle states", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).listArticles({ limit: 10 });
    expect(calls[0]?.sql).toContain("lifecycle_state IN ('PUBLISHED','UPDATED','CORRECTED')");
  });

  it("parameterizes every filter it accepts", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).listArticles({
      category: "politics",
      countryCode: "gb",
      breakingOnly: true,
      withImageOnly: true,
      sinceHours: 12,
      limit: 5,
      offset: 10
    });

    const call = calls[0]!;
    expect(call.sql).not.toContain("politics");
    expect(call.params).toContain("POLITICS");
    expect(call.params).toContain("GB");
    expect(call.params).toContain(5);
    expect(call.params).toContain(10);
    expect(call.sql).toContain("breaking_until > now()");
    expect(call.sql).toContain("image_url IS NOT NULL");
  });

  it("caps the page size so a client cannot request an unbounded scan", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).listArticles({ limit: 10_000 });
    expect(calls[0]?.params).toContain(100);
  });

  it("refuses a negative offset", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).listArticles({ limit: 10, offset: -50 });
    expect(calls[0]?.params).toContain(0);
  });

  it("computes the breaking flag from the window, not from a stored boolean", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).listArticles({ limit: 10 });
    // So a story stops presenting as breaking the moment its window closes,
    // even before the housekeeping job runs.
    expect(calls[0]?.sql).toContain("breaking_until > now()) AS breaking");
  });

  it("defaults attributionRequired to true when metadata lacks it", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).listArticles({ limit: 10 });
    expect(calls[0]?.sql).toContain("COALESCE((metadata->>'attributionRequired')::boolean, TRUE)");
  });

  it("returns a numeric total from countArticles", async () => {
    const { db } = recorder([{ total: 17 }]);
    await expect(new HomeRepository(db).countArticles({})).resolves.toBe(17);
  });

  it("returns zero rather than NaN when the count query yields nothing", async () => {
    const { db } = recorder([]);
    await expect(new HomeRepository(db).countArticles({})).resolves.toBe(0);
  });

  it("caps the trend query", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).categoryTrends(24, 500);
    expect(calls[0]?.params).toEqual([24, 20]);
  });
});

describe("home repository: lifecycle housekeeping", () => {
  it("clears the breaking window rather than retiring the article", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).demoteExpiredBreaking();

    const sql = calls[0]?.sql ?? "";
    // The closure pack set lifecycle_state='EXPIRED' here, which would have
    // removed every breaking-cleared story from World News 90 minutes after
    // publication.
    expect(sql).toContain("SET breaking_until=NULL");
    expect(sql).not.toContain("lifecycle_state='EXPIRED'");
  });

  it("expires articles by age, with a floor on the age argument", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).expireStaleArticles(0);
    expect(calls[0]?.sql).toContain("lifecycle_state='EXPIRED'");
    expect(calls[0]?.params).toEqual([1]);
  });

  it("prunes snapshots by retention window", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).pruneSnapshots(3);
    expect(calls[0]?.sql).toContain("DELETE FROM home_feed_snapshots");
    expect(calls[0]?.params).toEqual([3]);
  });
});

describe("home repository: snapshots", () => {
  it("writes the payload, its hash and a TTL", async () => {
    const { db, calls } = recorder();
    await new HomeRepository(db).saveSnapshot({
      userId: "u1",
      country: "US",
      payload: { a: 1 },
      hash: "f".repeat(64),
      ttlSeconds: 120
    });

    expect(calls[0]?.params).toEqual(["u1", "US", JSON.stringify({ a: 1 }), "f".repeat(64), 120]);
  });

  it("returns null when a user has no snapshot yet", async () => {
    const { db } = recorder([]);
    await expect(new HomeRepository(db).getLatestSnapshot("u1")).resolves.toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { PublisherTrustAdminService } from "../../home/publisher-trust.admin.service.js";
import type { Database } from "../../db/pool.js";
import type { PublisherTrustInput } from "../../home/publisher-trust.repository.js";

function fakePool(options: { failOnUpsert?: boolean } = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let released = false;

  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (options.failOnUpsert && sql.includes("INSERT INTO home_news_publishers")) {
        throw new Error("UNIQUE_VIOLATION");
      }
      if (sql.includes("SELECT") && sql.includes("home_news_publishers")) {
        return {
          rows: [{
            canonical_domain: "example.news",
            display_name: "Example News",
            trust_status: "TRUSTED",
            min_provider_score: 0.6,
            allow_breaking: false,
            allow_external_links: true,
            attribution_required: true
          }],
          rowCount: 1
        };
      }
      if (sql.startsWith("UPDATE") || sql.startsWith("DELETE")) return { rows: [], rowCount: 4 };
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(() => {
      released = true;
    })
  };

  const db = { connect: vi.fn(async () => client) } as unknown as Database;
  return { db, client, statements, wasReleased: () => released };
}

function input(overrides: Partial<PublisherTrustInput> = {}): PublisherTrustInput {
  return {
    domain: "Example.News",
    displayName: "Example News",
    countryCode: "US",
    trustStatus: "TRUSTED",
    minProviderScore: 0.6,
    allowBreaking: false,
    allowExternalLinks: true,
    attributionRequired: true,
    notes: null,
    ...overrides
  };
}

const context = {
  actorUserId: "00000000-0000-4000-8000-000000000001",
  actorScopes: ["ops:home:publisher:read", "ops:home:publisher:write"],
  requestId: "req-1",
  reasonCode: "APPROVED_BY_EDITORIAL_REVIEW"
};

describe("publisher trust admin: audited writes", () => {
  it("writes the upsert, an audit event and an outbox event in one transaction", async () => {
    const { db, statements } = fakePool();
    await new PublisherTrustAdminService(db).upsert(input(), context);

    const sql = statements.map((statement) => statement.sql);
    expect(sql[0]).toBe("BEGIN");
    expect(sql.some((text) => text.includes("INSERT INTO home_news_publishers"))).toBe(true);
    expect(sql.some((text) => text.includes("INSERT INTO ops_audit_events"))).toBe(true);
    expect(sql.some((text) => text.includes("INSERT INTO ops_outbox"))).toBe(true);
    expect(sql.at(-1)).toBe("COMMIT");
  });

  it("records the actor, their scopes and the stated reason on the audit row", async () => {
    const { db, statements } = fakePool();
    await new PublisherTrustAdminService(db).upsert(input(), context);

    const audit = statements.find((statement) => statement.sql.includes("ops_audit_events"))!;
    expect(audit.params[0]).toBe(context.actorUserId);
    expect(JSON.parse(String(audit.params[1]))).toEqual(context.actorScopes);
    expect(audit.params[2]).toBe("example.news");
    expect(audit.params[3]).toBe("APPROVED_BY_EDITORIAL_REVIEW");
    expect(audit.params[4]).toBe("req-1");
  });

  it("captures the before and after state so a change is explainable", async () => {
    const { db, statements } = fakePool();
    await new PublisherTrustAdminService(db).upsert(input({ trustStatus: "BLOCKED" }), context);

    const audit = statements.find((statement) => statement.sql.includes("ops_audit_events"))!;
    expect(JSON.parse(String(audit.params[5]))).toMatchObject({ canonical_domain: "example.news" });
    expect(JSON.parse(String(audit.params[6]))).toMatchObject({ canonical_domain: "example.news" });
  });

  it("lower-cases the domain so trust cannot be bypassed by casing", async () => {
    const { db, statements } = fakePool();
    await new PublisherTrustAdminService(db).upsert(input({ domain: "EXAMPLE.NEWS" }), context);

    const upsert = statements.find((statement) => statement.sql.includes("INSERT INTO home_news_publishers"))!;
    expect(upsert.params[0]).toBe("example.news");
  });

  it("rolls back and releases the client when the write fails", async () => {
    const { db, statements, wasReleased } = fakePool({ failOnUpsert: true });

    await expect(new PublisherTrustAdminService(db).upsert(input(), context))
      .rejects.toThrow("UNIQUE_VIOLATION");

    expect(statements.map((statement) => statement.sql)).toContain("ROLLBACK");
    expect(statements.map((statement) => statement.sql)).not.toContain("COMMIT");
    expect(wasReleased()).toBe(true);
  });

  it("publishes the trust transition on the outbox event", async () => {
    const { db, statements } = fakePool();
    await new PublisherTrustAdminService(db).upsert(input({ trustStatus: "BLOCKED" }), context);

    const outbox = statements.find((statement) => statement.sql.includes("ops_outbox"))!;
    const payload = JSON.parse(String(outbox.params[1])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      domain: "example.news",
      trustStatus: "BLOCKED",
      previousTrustStatus: "TRUSTED",
      reasonCode: "APPROVED_BY_EDITORIAL_REVIEW"
    });
  });
});

describe("publisher trust admin: blocking takes effect immediately", () => {
  it("rejects the publisher's stored articles and clears cached feeds", async () => {
    const { db, statements } = fakePool();
    const result = await new PublisherTrustAdminService(db).purgePublisherContent("Example.News");

    const articleUpdate = statements.find((statement) => statement.sql.includes("home_news_articles"))!;
    expect(articleUpdate.sql).toContain("lifecycle_state='REJECTED'");
    expect(articleUpdate.params).toEqual(["example.news"]);

    // Cached feeds are keyed by query, not by publisher, so the only correct
    // move is to drop them and let the next read rebuild.
    expect(statements.some((statement) => statement.sql.includes("DELETE FROM home_news_cache_entries"))).toBe(true);
    expect(result).toEqual({ articles: 4, cacheEntries: 4 });
  });

  it("commits the purge as one transaction", async () => {
    const { db, statements } = fakePool();
    await new PublisherTrustAdminService(db).purgePublisherContent("example.news");

    const sql = statements.map((statement) => statement.sql);
    expect(sql[0]).toBe("BEGIN");
    expect(sql.at(-1)).toBe("COMMIT");
  });
});

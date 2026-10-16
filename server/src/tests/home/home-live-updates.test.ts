import { describe, expect, it, vi } from "vitest";
import { createHomeDependencies } from "../../home/home-dependencies.js";
import type { Database } from "../../db/pool.js";
import type { HomeRepository } from "../../home/home.repository.js";

describe("worldwide Live Updates", () => {
  it("includes all four topics before repeating and preserves attribution", async () => {
    const listArticles = vi.fn(async ({ category }: { category: string }) => [0, 1].map(index => ({
      id: `${category}-${index}`, canonicalUrl: `https://publisher.com/${category}/${index}`,
      title: `${category} headline`, category, publisherName: "Publisher", publisherDomain: "publisher.com",
      publishedAt: new Date().toISOString(), breaking: false, attributionRequired: true
    })));
    const dependencies = createHomeDependencies({} as Database, { listArticles } as unknown as HomeRepository);
    const updates = await dependencies.getLiveUpdates("user", "US") as { category: string; publisherName: string }[];
    expect(updates.map(item => item.category)).toEqual([
      "TECHNOLOGY", "HEALTH", "CLIMATE", "BUSINESS", "TECHNOLOGY", "HEALTH", "CLIMATE", "BUSINESS"
    ]);
    expect(updates.every(item => item.publisherName === "Publisher")).toBe(true);
    expect(listArticles.mock.calls.every(([query]) => !("countryCode" in query))).toBe(true);
  });

  it("does not invent headlines for topics with no recent coverage", async () => {
    const dependencies = createHomeDependencies({} as Database, { listArticles: vi.fn(async () => []) } as unknown as HomeRepository);
    expect(await dependencies.getLiveUpdates("user", "US")).toEqual([]);
  });
});

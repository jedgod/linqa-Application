import { describe, expect, it, vi } from "vitest";
import { GlobalNewsService } from "../services/global-news.service.js";

const articles = [
  ["AI research expands worldwide", "TECHNOLOGY"],
  ["Health initiative reaches new regions", "HEALTH"],
  ["Climate policy advances in parliament", "POLITICS"],
  ["Markets respond to global trade agreement", "BUSINESS"]
].map(([title], index) => ({
  title,
  url: `https://news.example/story-${index}`,
  socialimage: `https://images.example/story-${index}.jpg`,
  domain: "news.example",
  sourcecountry: "United States",
  seendate: `20260829T0${index}0000Z`
}));

describe("GlobalNewsService", () => {
  it("normalizes a live GDELT article feed and caches it", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ articles }), { status: 200 }));
    const service = new GlobalNewsService(fetcher as typeof fetch);

    const first = await service.load();
    const second = await service.load();

    expect(first.status).toBe("LIVE");
    expect(first.stories).toHaveLength(4);
    expect(first.stories[0]).toMatchObject({ source: "news.example", category: "TECHNOLOGY" });
    expect(first.stories.every((story) => story.url.startsWith("https://"))).toBe(true);
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails visibly when the external provider is unavailable", async () => {
    const service = new GlobalNewsService(vi.fn(async () => { throw new Error("offline"); }) as typeof fetch);
    await expect(service.load()).resolves.toMatchObject({ status: "UNAVAILABLE", stories: [] });
  });
});

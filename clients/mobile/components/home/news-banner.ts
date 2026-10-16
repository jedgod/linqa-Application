import type { HomeNewsItem } from "../../services/home-feed.service";

const WEATHER_WORDS = /\b(weather|storm\w*|hurricane\w*|cyclone\w*|typhoon\w*|tornado\w*|flood\w*|heat\s?wave\w*|snow\w*|blizzard\w*|rainfall|drought\w*|wildfire\w*)\b/i;

export function isWeatherNews(story: HomeNewsItem): boolean {
  return story.category === "CLIMATE" || story.category === "WEATHER" || WEATHER_WORDS.test(story.title);
}

export function bannerLabel(story: HomeNewsItem | null): string {
  if (story && isWeatherNews(story)) return story.category === "WEATHER" || WEATHER_WORDS.test(story.title) ? "WEATHER NEWS" : "CLIMATE NEWS";
  return story?.breakingEligible ? "BREAKING NEWS" : "WORLD NEWS";
}

/** Keep publisher variety and reserve every fourth card for weather. */
export function selectBannerStories(stories: HomeNewsItem[], limit: number): HomeNewsItem[] {
  const urls = new Set<string>();
  const unique = stories.filter(story => {
    if (urls.has(story.canonicalUrl)) return false;
    urls.add(story.canonicalUrl);
    return true;
  });
  const weather = unique.filter(isWeatherNews);
  const general = unique.filter(story => !isWeatherNews(story));
  const publishers = new Set<string>();
  const first = general.filter(story => {
    if (publishers.has(story.publisherDomain)) return false;
    publishers.add(story.publisherDomain);
    return true;
  });
  const firstUrls = new Set(first.map(story => story.canonicalUrl));
  const remaining = [...first, ...general.filter(story => !firstUrls.has(story.canonicalUrl))];
  const selected: HomeNewsItem[] = [];
  while (selected.length < limit && (remaining.length || weather.length)) {
    const next = (selected.length % 4 === 1 && weather.length) || !remaining.length ? weather.shift() : remaining.shift();
    if (next) selected.push(next);
  }
  return selected;
}

import test from "node:test";
import assert from "node:assert/strict";
import { categoryChips, communityFilters, connectLabel, eventWhen, filterCountries, formatCount, membersLabel, rankCommunities, flagOf, headline, joinPeople, locationLine, peopleRequest, reachesCountry, titleCase } from "../clients/mobile/services/countrylinqa-world.ts";

const catalog = {
  countries: [
    { code: "US", name: "United States", callingCode: "1", regionCode: "NA" },
    { code: "CA", name: "Canada", callingCode: "1", regionCode: "NA" },
    { code: "GH", name: "Ghana", callingCode: "233", regionCode: "AF-W" },
    { code: "NG", name: "Nigeria", callingCode: "234", regionCode: "AF-W" }
  ],
  regions: [{ code: "NA", name: "North America", parentCode: null }, { code: "AF-W", name: "West Africa", parentCode: "AF" }]
};

test("location shows only what a person chose, and USA for the United States", () => {
  assert.equal(locationLine({ city: "New York", state: "NY", countryCode: "US", countryName: "United States" }), "New York, USA");
  assert.equal(locationLine({ city: null, state: "TX", countryCode: "US", countryName: "United States" }), "TX, USA");
  assert.equal(locationLine({ city: null, state: null, countryCode: "GH", countryName: "Ghana" }), "Ghana");
  assert.equal(locationLine({ city: null, state: null, countryCode: null, countryName: null }), "");
});

test("headline is the profession then the first interest", () => {
  assert.equal(headline({ professionCode: "photographer", interests: ["travel", "music"] }), "Photographer • Travel");
  assert.equal(headline({ professionCode: "software engineer", interests: [] }), "Software Engineer");
  assert.equal(headline({ professionCode: null, interests: ["music"] }), "Music");
  assert.equal(headline({ professionCode: null, interests: [] }), "");
  assert.equal(titleCase("ui_designer"), "Ui Designer");
});

test("the connect button follows the connection state", () => {
  assert.deepEqual(connectLabel(null), { label: "Connect", action: "CONNECT" });
  assert.deepEqual(connectLabel({ id: "1", status: "ACCEPTED", incoming: false }), { label: "Connected", action: "NONE" });
  assert.deepEqual(connectLabel({ id: "1", status: "PENDING", incoming: false }), { label: "Request sent", action: "NONE" });
  assert.deepEqual(connectLabel({ id: "1", status: "PENDING", incoming: true }), { label: "Respond", action: "RESPOND" });
});

test("each People tab only narrows the request", () => {
  const ctx = { country: "US", region: "NA" };
  assert.deepEqual(peopleRequest("FOR_YOU", ctx), { kind: "RECOMMENDED" });
  assert.deepEqual(peopleRequest("COUNTRY", ctx, { query: "ol" }), { kind: "SEARCH", filters: { query: "ol", countries: ["US"] } });
  assert.deepEqual(peopleRequest("REGION", ctx), { kind: "SEARCH", filters: { region: "NA" } });
  assert.deepEqual(peopleRequest("GLOBAL", ctx, { interests: ["music"] }), { kind: "SEARCH", filters: { interests: ["music"] } });
  assert.equal(peopleRequest("COUNTRY", { country: null, region: null }).kind, "EMPTY");
  assert.equal(peopleRequest("REGION", { country: "US", region: null }).kind, "EMPTY");
});

test("the app says up front which countries the user's settings reach", () => {
  const base = { verifiedCountryCode: "US", selectedCountries: [] as string[], selectedRegions: [] as string[] };
  assert.equal(reachesCountry({ ...base, mode: "MY_COUNTRY" }, catalog, "US"), true);
  assert.equal(reachesCountry({ ...base, mode: "MY_COUNTRY" }, catalog, "GH"), false);
  assert.equal(reachesCountry({ ...base, mode: "SELECTED_COUNTRIES", selectedCountries: ["GH"] }, catalog, "GH"), true);
  assert.equal(reachesCountry({ ...base, mode: "SELECTED_COUNTRIES", selectedCountries: ["GH"] }, catalog, "NG"), false);
  assert.equal(reachesCountry({ ...base, mode: "REGION", selectedRegions: ["AF-W"] }, catalog, "NG"), true);
  assert.equal(reachesCountry({ ...base, mode: "REGION", selectedRegions: ["AF-W"] }, catalog, "CA"), false);
  assert.equal(reachesCountry({ ...base, mode: "GLOBAL" }, catalog, "NG"), true);
});

test("ranked people without details are dropped, the rest keep their rank order", () => {
  const ranked = [{ id: "a", reasons: ["X"] }, { id: "b", reasons: [] }, { id: "c", reasons: [] }] as never;
  const detail = (id: string) => ({ id, displayName: id, bio: null, verified: true, countryCode: null, countryName: null, state: null, city: null, professionCode: null, interests: [], connection: null });
  assert.deepEqual(joinPeople(ranked, [detail("c"), detail("a")]).map((p) => p.id), ["a", "c"]);
});

test("country search puts your own country first, then A to Z", () => {
  assert.deepEqual(filterCountries(catalog, "", "NG").map((c) => c.code), ["NG", "CA", "GH", "US"]);
  assert.deepEqual(filterCountries(catalog, "ni", null).map((c) => c.code), ["NG", "US"]);
  assert.equal(flagOf("us").codePointAt(0), 0x1f1fa);
});

test("counts read like the mockups", () => {
  assert.equal(formatCount(428), "428");
  assert.equal(formatCount(12_800), "12.8K");
  assert.equal(formatCount(1_200), "1.2K");
  assert.equal(formatCount(8_000), "8K");
  assert.equal(formatCount(100, true), "100+");
  assert.equal(formatCount(1_500_000), "1.5M");
  assert.equal(membersLabel(1), "1 member");
  assert.equal(membersLabel(8_200), "8.2K members");
});

test("event dates read as the mockup and bad dates are empty", () => {
  assert.match(eventWhen("2026-10-24T19:00:00Z"), /^Oct (24|25), 2026, \d{1,2}:\d{2} (AM|PM)$/);
  assert.equal(eventWhen("nonsense"), "");
  assert.equal(eventWhen(undefined), "");
});

test("community tabs only narrow, and your own country comes first on For You", () => {
  const ctx = { country: "US", region: "NA" };
  assert.deepEqual(communityFilters("FOR_YOU", ctx), {});
  assert.deepEqual(communityFilters("COUNTRY", ctx), { country: "US" });
  assert.deepEqual(communityFilters("REGION", ctx), { region: "NA" });
  assert.deepEqual(communityFilters("GLOBAL", ctx), {});
  assert.equal(communityFilters("COUNTRY", { country: null, region: null }), null);
  const items = [{ id: "GH", title: "Ghana", memberCount: 5 }, { id: "CA", title: "Canada", memberCount: 9 }, { id: "US", title: "United States", memberCount: 1 }, { id: "BR", title: "Brazil", memberCount: 9 }];
  assert.deepEqual(rankCommunities(items, "US").map((i) => i.id), ["US", "BR", "CA", "GH"]);
});

test("business categories are the ones that exist, most common first", () => {
  assert.deepEqual(categoryChips(["restaurant", "hotel", "restaurant", undefined, "shop", "hotel", "restaurant"]), ["restaurant", "hotel", "shop"]);
  assert.deepEqual(categoryChips([]), []);
});

test("a chat only starts after an in-app tap: outside links, other people, stale taps and repeats do not", async () => {
  const { armChatStart, consumeChatStart } = await import("../clients/mobile/services/countrylinqa-world.ts");
  assert.equal(consumeChatStart("u1", 0), false);             // an outside link, nothing armed
  armChatStart("u1", 1000);
  assert.equal(consumeChatStart("u2", 2000), false);          // armed for someone else
  armChatStart("u1", 1000);
  assert.equal(consumeChatStart("u1", 2000), true);           // the real tap
  assert.equal(consumeChatStart("u1", 2001), false);          // only once
  armChatStart("u1", 1000);
  assert.equal(consumeChatStart("u1", 1000 + 16_000), false); // too old
  assert.equal(consumeChatStart(undefined, 0), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { activeFilterCount, decodeSearch, describeSearch, emptySearch, encodeSearch, fromSavedFilters, lastUsedLabel, setPendingSearch, sortRows, takePendingSearch, toCollectionFilters, toPeopleFilters, toSavedFilters } from "../clients/mobile/services/countrylinqa-search.ts";
import { discoveredCountries, manageSubscriptionTarget, reachSummaries, savePayload } from "../clients/mobile/services/countrylinqa-settings.ts";

const catalog = {
  countries: [
    { code: "US", name: "United States", callingCode: "1", regionCode: "NA" }, { code: "GH", name: "Ghana", callingCode: "233", regionCode: "AF-W" },
    { code: "CA", name: "Canada", callingCode: "1", regionCode: "NA" }, { code: "GB", name: "United Kingdom", callingCode: "44", regionCode: "EU" }
  ],
  regions: [{ code: "NA", name: "North America", parentCode: null }, { code: "AF-W", name: "West Africa", parentCode: "AF" }]
};
const prefs = (over: Record<string, unknown> = {}) => ({
  mode: "MY_COUNTRY", verifiedCountryCode: "US", verificationState: "VERIFIED", selectedCountries: [], selectedRegions: [], inboundReach: "MY_COUNTRY", inboundSelectedCountries: [], inboundSelectedRegions: [],
  locationPrecision: "COUNTRY", showCity: false, showState: false, showCountry: true, verifiedOnly: true, allowBusinesses: true, allowCommunities: true, allowEvents: true, paused: false,
  chatReachMode: "MY_COUNTRY", chatSelectedCountries: [], chatRegionCode: null, chatExistingContactsBypass: true, allowedChatModes: {}, activated: true, version: 7, subscriptionTier: "FREE", allowedModes: {}, selectionLimits: { countries: 0, regions: 0 }, ...over
}) as never;

test("the people search sends only what was filled in, and always the verified switch", () => {
  assert.deepEqual(toPeopleFilters(emptySearch()), { verifiedOnly: true });
  const s = { ...emptySearch(), query: " ava ", country: "US", city: "Austin ", interests: ["music"], languages: ["english"], profession: " Designer ", verifiedOnly: false };
  assert.deepEqual(toPeopleFilters(s), { query: "ava", countries: ["US"], city: "Austin", interests: ["music"], languages: ["english"], profession: "designer", verifiedOnly: false });
});

test("business and event searches use only the filters those lists understand", () => {
  const s = { ...emptySearch("businesses"), query: "sun", country: "US", region: "NA", category: "restaurant", city: "Austin", interests: ["music"] };
  assert.deepEqual(toCollectionFilters(s), { q: "sun", country: "US", region: "NA", category: "restaurant" });
  assert.deepEqual(toCollectionFilters({ ...s, kind: "events" }), { q: "sun", country: "US", region: "NA" });
});

test("saved filters round-trip, and the original single-language shape still loads", () => {
  const s = { ...emptySearch(), query: "dev", country: "GH", interests: ["technology"], languages: ["english", "twi"], profession: "developer", city: "Accra" };
  const back = fromSavedFilters(toSavedFilters(s));
  assert.deepEqual(back, s);
  const legacy = fromSavedFilters({ q: "x", country: "US", language: "en", verifiedOnly: false });
  assert.deepEqual(legacy.languages, ["en"]);
  assert.equal(legacy.verifiedOnly, false);
  assert.deepEqual(fromSavedFilters(null), emptySearch());
  assert.deepEqual(fromSavedFilters({ interests: [1, "ok"], unknown: true }).interests, ["ok"]);
});

test("route state survives encoding and bad input falls back safely", () => {
  const s = { ...emptySearch("events"), query: "fest", country: "gh", sort: "NAME" as const };
  const back = decodeSearch(encodeSearch(s));
  assert.equal(back.kind, "events");
  assert.equal(back.country, "GH");
  assert.equal(back.sort, "NAME");
  assert.deepEqual(decodeSearch("not json"), emptySearch());
  assert.deepEqual(decodeSearch(undefined, "businesses"), emptySearch("businesses"));
  assert.equal(decodeSearch(JSON.stringify({ kind: "hack", sort: "DROP" })).kind, "people");
});

test("the filter badge counts narrowing filters, not sort or the verified switch", () => {
  assert.equal(activeFilterCount(emptySearch()), 0);
  assert.equal(activeFilterCount({ ...emptySearch(), country: "US", interests: ["a", "b"], languages: ["x"], verifiedOnly: false, sort: "NAME" }), 3);
});

test("the search line and sorting read well", () => {
  assert.equal(describeSearch(emptySearch()), "Everyone in your discovery scope");
  assert.equal(describeSearch({ ...emptySearch(), query: "ava", interests: ["travel"], profession: "ui designer" }, { country: "United States" }), '"ava" · United States · Travel · Ui Designer');
  const rows = [{ name: "Zed" }, { name: "Amy" }];
  assert.deepEqual(sortRows(rows, "RELEVANT").map((r) => r.name), ["Zed", "Amy"]);
  assert.deepEqual(sortRows(rows, "NAME").map((r) => r.name), ["Amy", "Zed"]);
});

test("last used reads like the mockup", () => {
  const now = new Date(2026, 9, 12, 12);
  const at = (days: number) => new Date(2026, 9, 12 - days, 9).toISOString();
  assert.equal(lastUsedLabel(at(0), now), "Last used today");
  assert.equal(lastUsedLabel(at(1), now), "Last used yesterday");
  assert.equal(lastUsedLabel(at(2), now), "Last used 2 days ago");
  assert.equal(lastUsedLabel(at(7), now), "Last used 1 week ago");
  assert.equal(lastUsedLabel(at(14), now), "Last used 2 weeks ago");
  assert.equal(lastUsedLabel(at(45), now), "Last used 1 month ago");
  assert.equal(lastUsedLabel(null, now), "Never used");
  assert.equal(lastUsedLabel("junk", now), "Never used");
});

test("filters are handed back to the results screen exactly once", () => {
  assert.equal(takePendingSearch(), null);
  const s = { ...emptySearch(), city: "Austin" };
  setPendingSearch(s);
  assert.deepEqual(takePendingSearch(), s);
  assert.equal(takePendingSearch(), null);
});

test("settings home shows one short value per control", () => {
  assert.deepEqual(reachSummaries(prefs(), catalog), { discover: "United States", discoverMe: "United States", chatMe: "United States" });
  const wide = reachSummaries(prefs({ mode: "SELECTED_COUNTRIES", selectedCountries: ["GH", "CA", "GB"], inboundReach: "GLOBAL", chatReachMode: "EXISTING_CONTACTS_ONLY" }), catalog);
  assert.deepEqual(wide, { discover: "3 countries", discoverMe: "Worldwide", chatMe: "Existing contacts only" });
  assert.equal(reachSummaries(prefs({ mode: "SELECTED_COUNTRIES", selectedCountries: ["GH"] }), catalog).discover, "Ghana");
  assert.equal(reachSummaries(prefs({ mode: "REGION", selectedRegions: ["AF-W"] }), catalog).discover, "West Africa");
  assert.equal(reachSummaries(prefs({ chatReachMode: "REGION" }), catalog).chatMe, "North America");
  assert.equal(reachSummaries(prefs({ chatReachMode: "NOBODY" }), catalog).chatMe, "Nobody");
});

test("manage countries lists your own country first, then the ones you chose", () => {
  assert.deepEqual(discoveredCountries(prefs()), ["US"]);
  assert.deepEqual(discoveredCountries(prefs({ mode: "SELECTED_COUNTRIES", selectedCountries: ["GH", "US", "CA"] })), ["US", "GH", "CA"]);
  assert.deepEqual(discoveredCountries(prefs({ verifiedCountryCode: null })), []);
});

test("every settings save sends the whole policy, and chosen countries only for the mode that uses them", () => {
  const base = prefs({ mode: "SELECTED_COUNTRIES", selectedCountries: ["GH"], selectedRegions: ["NA"], inboundSelectedCountries: ["CA"], chatSelectedCountries: ["GB"] });
  const p = savePayload(base, { paused: true });
  assert.equal(p.paused, true);
  assert.equal(p.mode, "SELECTED_COUNTRIES");
  assert.deepEqual(p.selectedCountries, ["GH"]);
  assert.deepEqual(p.selectedRegions, []);
  assert.deepEqual(p.inboundSelectedCountries, []);
  assert.deepEqual(p.chatReach, { mode: "MY_COUNTRY", existingContactsBypass: true });
  assert.equal(p.expectedVersion, 7);
  const away = savePayload(base, { mode: "MY_COUNTRY", selectedCountries: [] });
  assert.deepEqual(away.selectedCountries, []);
  assert.deepEqual(savePayload(prefs({ chatReachMode: "SELECTED_COUNTRIES", chatSelectedCountries: ["GB"] })).chatReach, { mode: "SELECTED_COUNTRIES", selectedCountries: ["GB"], existingContactsBypass: true });
  assert.equal(savePayload(prefs({ showCity: true })).locationPrecision, "CITY");
  assert.equal(savePayload(prefs({ showState: true })).locationPrecision, "STATE");
});

test("manage subscription goes where the subscription lives", () => {
  assert.deepEqual(manageSubscriptionTarget("APPLE"), { kind: "URL", url: "https://apps.apple.com/account/subscriptions" });
  assert.deepEqual(manageSubscriptionTarget("GOOGLE"), { kind: "URL", url: "https://play.google.com/store/account/subscriptions" });
  assert.deepEqual(manageSubscriptionTarget("STRIPE"), { kind: "SUPPORT" });
  assert.deepEqual(manageSubscriptionTarget(null), { kind: "NONE" });
});

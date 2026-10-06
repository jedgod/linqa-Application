import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVATION_STEPS, activationPayload, activationSummary, chatStartError, defaultChoices, reachOptions, regionOfCountry, stepError } from "../clients/mobile/services/countrylinqa-activation.ts";

const verified = { verifiedCountryCode: "US", verificationState: "VERIFIED" };

test("the flow follows the six screens in order", () => {
  assert.deepEqual(ACTIVATION_STEPS, ["WELCOME", "COUNTRY", "DISCOVERY", "DISCOVERABILITY", "CHAT", "READY"]);
});

test("everything starts as My Country and the first save is a single request", () => {
  const payload = activationPayload(defaultChoices(), { version: 1 }, "NA");
  assert.equal(payload.mode, "MY_COUNTRY");
  assert.equal(payload.inboundReach, "MY_COUNTRY");
  assert.deepEqual(payload.chatReach, { mode: "MY_COUNTRY" });
  assert.equal(payload.activate, true);
  assert.deepEqual(payload.selectedCountries, []);
  assert.deepEqual(payload.selectedRegions, []);
  assert.equal(payload.expectedVersion, 1);
});

test("My Region uses the region of the user's own country", () => {
  const choices = { ...defaultChoices(), discovery: "REGION" as const, discoverability: "REGION" as const, chat: "REGION" as const };
  const payload = activationPayload(choices, { version: 3 }, "NA");
  assert.deepEqual(payload.selectedRegions, ["NA"]);
  assert.deepEqual(payload.inboundSelectedRegions, ["NA"]);
  assert.deepEqual(payload.chatReach, { mode: "REGION", regionCode: "NA" });
});

test("chosen countries are sent only for the screen that chose them", () => {
  const choices = { ...defaultChoices(), discovery: "SELECTED_COUNTRIES" as const, discoveryCountries: ["GH"], discoverabilityCountries: ["NG"], chat: "SELECTED_COUNTRIES" as const, chatCountries: ["CA", "GB"] };
  const payload = activationPayload(choices, { version: 1 }, null);
  assert.deepEqual(payload.selectedCountries, ["GH"]);
  assert.deepEqual(payload.inboundSelectedCountries, []); // discoverability is still My Country
  assert.deepEqual(payload.chatReach, { mode: "SELECTED_COUNTRIES", selectedCountries: ["CA", "GB"] });
});

test("a screen can not move on without what it needs", () => {
  assert.match(stepError("COUNTRY", defaultChoices(), { verifiedCountryCode: null, verificationState: "UNVERIFIED" })!, /Confirm your country/);
  assert.equal(stepError("COUNTRY", defaultChoices(), verified), null);
  assert.match(stepError("DISCOVERY", { ...defaultChoices(), discovery: "SELECTED_COUNTRIES" }, verified)!, /at least one country/);
  assert.match(stepError("CHAT", { ...defaultChoices(), chat: "SELECTED_COUNTRIES" }, verified)!, /at least one country/);
  assert.equal(stepError("CHAT", { ...defaultChoices(), chat: "NOBODY" }, verified), null);
});

test("the option lists match the mockups", () => {
  const o = reachOptions("United States", "North America");
  assert.deepEqual(o.discovery.map((x) => x.label), ["My Country", "Selected Countries", "My Region", "Worldwide"]);
  assert.deepEqual(o.discoverability.map((x) => x.label), ["My Country", "Selected Countries", "My Region", "Worldwide", "Existing Contacts Only"]);
  assert.deepEqual(o.chat.map((x) => x.label), ["My Country", "Selected Countries", "My Region", "Worldwide", "Existing Contacts Only", "Nobody"]);
  assert.equal(o.discovery[0]!.detail, "United States");
  assert.equal(o.discovery[2]!.detail, "North America");
});

test("the ready screen summarises the three choices", () => {
  assert.deepEqual(activationSummary({ ...defaultChoices(), discoverability: "CONTACTS_ONLY", chat: "NOBODY" }), [
    { label: "Discovery", value: "My Country" }, { label: "Discover Me", value: "Existing Contacts" }, { label: "Chat Me", value: "Nobody" }
  ]);
});

test("region lookup follows the catalog", () => {
  const catalog = { countries: [{ code: "US", name: "United States", callingCode: "1", regionCode: "NA" }], regions: [{ code: "NA", name: "North America", parentCode: null }] };
  assert.deepEqual(regionOfCountry(catalog, "US"), { code: "NA", name: "North America" });
  assert.deepEqual(regionOfCountry(catalog, "ZZ"), { code: null, name: null });
});

test("a refused chat is explained without naming other people's settings", () => {
  for (const code of ["COUNTRY_NOT_ALLOWED", "CONTACTS_ONLY", "CHAT_REQUESTS_DISABLED"]) assert.match(chatStartError(code), /isn't accepting new chat requests/);
  assert.match(chatStartError("COUNTRY_UNVERIFIED"), /verification/);
  assert.equal(chatStartError("BLOCKED"), "You can't start this conversation.");
  assert.equal(chatStartError(undefined), "You can't start this conversation.");
});

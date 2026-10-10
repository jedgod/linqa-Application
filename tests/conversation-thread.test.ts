import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ACTIONS, BACKGROUNDS, THREAD_ACTIONS, assertPayload, enabledActions, unavailableReason, type ThreadAction, type ThreadPayload } from "../clients/mobile/services/conversation-thread.ts";
import { DEFAULT_PREFS, THEMES, chatTheme, parsePrefs } from "../clients/mobile/services/conversation-engine.ts";

test("the sheet lists the twelve actions from the thread pack", () => {
  const labels = THREAD_ACTIONS.map((a) => a.label);
  assert.deepEqual(labels.sort(), ["AI image", "Contact", "Design / crop", "Document", "Event", "Location", "Photos", "Poll", "Record video", "Record voice", "Schedule meeting", "Share live screen"]);
});

test("consent is required for location, contact, voice, video and live screen", () => {
  assert.deepEqual(THREAD_ACTIONS.filter((a) => a.needsConsent).map((a) => a.id), ["VIDEO", "VOICE", "LOCATION", "CONTACT", "LIVE_SCREEN"]);
});

test("payloads: a poll needs two options, a location must be on the map, vault ids are required, and the kind must match", () => {
  assert.throws(() => assertPayload("POLL", { kind: "POLL", question: "When?", options: ["Now", " "], allowsMultiple: false }), /POLL_NEEDS_TWO_OPTIONS/);
  assert.throws(() => assertPayload("LOCATION", { kind: "LOCATION", label: "Site", latitude: 120, longitude: 0 }), /LOCATION_INVALID/);
  assert.throws(() => assertPayload("LOCATION", { kind: "LOCATION", label: "Site", latitude: Number.NaN, longitude: 0 }), /LOCATION_INVALID/);
  assert.throws(() => assertPayload("PHOTO", { kind: "PHOTO", vaultId: "", width: 1, height: 1 }), /VAULT_ID_REQUIRED/);
  assert.throws(() => assertPayload("POLL", { kind: "MEETING", title: "x", startsAt: "2026-10-09T14:00:00.000Z", durationMinutes: 30 }), /THREAD_PAYLOAD_MISMATCH/);
  const photo: ThreadPayload = { kind: "PHOTO", vaultId: "vault_1", width: 1000, height: 800 };
  const meeting: ThreadPayload = { kind: "MEETING", title: "Walkthrough", startsAt: "2026-10-09T14:00:00.000Z", durationMinutes: 45 };
  assert.doesNotThrow(() => assertPayload("PHOTO", photo));
  assert.doesNotThrow(() => assertPayload("MEETING", meeting));
});

test("a feature switched off stays out of the sheet, in the pack's order", () => {
  const enabled: ThreadAction[] = ["PHOTO", "POLL", "MEETING"];
  assert.deepEqual(enabledActions(enabled).map((a) => a.id), enabled);
  assert.deepEqual(enabledActions([]), []);
});

test("preferences: AI is opt-in; a stored list is honoured, unknown ids dropped, an empty list stays empty", () => {
  assert.deepEqual(DEFAULT_PREFS.features, ALL_ACTIONS.filter(id => id !== "AI_IMAGE"));
  assert.equal(DEFAULT_PREFS.background, "AUTO");
  assert.deepEqual(parsePrefs(JSON.stringify({ features: ["POLL", "NOPE", "PHOTO"] })).features, ["PHOTO", "POLL"]);
  assert.deepEqual(parsePrefs(JSON.stringify({ features: [] })).features, []);
  assert.deepEqual(parsePrefs(JSON.stringify({ theme: "dark" })).features, DEFAULT_PREFS.features);
  assert.equal(parsePrefs(JSON.stringify({ background: "FOREST" })).background, "FOREST");
  assert.equal(parsePrefs(JSON.stringify({ background: "neon" })).background, "AUTO");
});

test("backgrounds: Auto keeps the theme; fixed ones bring a palette that reads on them", () => {
  assert.equal(chatTheme(THEMES.dark, "AUTO"), THEMES.dark);
  const ink = chatTheme(THEMES.light, "INK");
  assert.equal(ink.background, BACKGROUNDS.INK);
  assert.equal(ink.ink, THEMES.dark.ink);
  const mist = chatTheme(THEMES.dark, "MIST");
  assert.equal(mist.background, BACKGROUNDS.MIST);
  assert.equal(mist.ink, THEMES.light.ink);
});

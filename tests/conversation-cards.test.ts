import test from "node:test";
import assert from "node:assert/strict";
import { ALL_ACTIONS, buildCardPayload, canSendPin, cardWhen, defaultCardForm, fromThreadPayload, regionFor, toThreadPayload, unavailableReason } from "../clients/mobile/services/conversation-thread.ts";
import { ConversationService, type SecureMessaging } from "../clients/mobile/services/conversation.service.ts";

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const form = (patch: Partial<ReturnType<typeof defaultCardForm>>) => ({ ...defaultCardForm(NOW), ...patch });

test("structured shares work; actions needing additional integrations say why", () => {
  for (const id of ["POLL", "EVENT", "MEETING", "LOCATION", "CONTACT"] as const) assert.equal(unavailableReason(id), null, id);
  for (const id of ALL_ACTIONS.filter((x) => !["POLL", "EVENT", "MEETING", "LOCATION", "CONTACT"].includes(x))) assert.match(unavailableReason(id) ?? "", /version|access/i, id);
});

test("the form starts tomorrow at ten", () => {
  assert.deepEqual(defaultCardForm(NOW), { title: "", date: "2026-10-07", time: "10:00", place: "", durationMinutes: "30" });
});

test("an event: title, a future local date and time, an optional place", () => {
  const ok = buildCardPayload("EVENT", form({ title: "  Team dinner ", place: " Cafe Roma " }), NOW);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.payload, { type: "event", title: "Team dinner", startsAt: new Date(2026, 9, 7, 10, 0).toISOString(), place: "Cafe Roma" });
  const noPlace = buildCardPayload("EVENT", form({ title: "Dinner" }), NOW);
  assert.equal(noPlace.ok && "place" in noPlace.payload, false);
});

test("a meeting needs a length of 5 to 480 minutes", () => {
  const ok = buildCardPayload("MEETING", form({ title: "Walkthrough", durationMinutes: "45" }), NOW);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.payload, { type: "meeting", title: "Walkthrough", startsAt: new Date(2026, 9, 7, 10, 0).toISOString(), durationMinutes: 45 });
  for (const bad of ["4", "481", "", "abc", "30.5"]) assert.equal(buildCardPayload("MEETING", form({ title: "x", durationMinutes: bad }), NOW).ok, false, bad);
});

test("the form refuses a missing title, a made-up date, a bad time and a time that has passed", () => {
  const bad = (patch: Partial<ReturnType<typeof defaultCardForm>>) => buildCardPayload("EVENT", form({ title: "x", ...patch }), NOW);
  assert.equal(buildCardPayload("EVENT", form({ title: "   " }), NOW).ok, false);
  assert.equal(bad({ date: "2026-02-30" }).ok, false);
  assert.equal(bad({ date: "10/07/2026" }).ok, false);
  assert.equal(bad({ time: "25:00" }).ok, false);
  assert.equal(bad({ time: "9am" }).ok, false);
  assert.equal(bad({ date: "2026-10-06", time: "11:59" }).ok, false);
  assert.equal(bad({ date: "2026-10-06", time: "12:00" }).ok, false);
  assert.equal(bad({ date: "2026-10-06", time: "12:01" }).ok, true);
  assert.equal(buildCardPayload("EVENT", form({ title: "x".repeat(121) }), NOW).ok, false);
});

test("the pack's sealed form ({ kind }) and the app's form ({ type }) convert both ways and refuse anything else", () => {
  const event = { type: "event" as const, title: "Dinner", startsAt: "2026-10-09T18:00:00.000Z", place: "Roma" };
  const meeting = { type: "meeting" as const, title: "Sync", startsAt: "2026-10-09T18:00:00.000Z", durationMinutes: 30 };
  assert.deepEqual(toThreadPayload(event), { kind: "EVENT", title: "Dinner", startsAt: "2026-10-09T18:00:00.000Z", place: "Roma" });
  assert.deepEqual(fromThreadPayload(toThreadPayload(event)), event);
  assert.deepEqual(fromThreadPayload(toThreadPayload(meeting)), meeting);
  for (const junk of [null, 5, {}, { kind: "PHOTO", title: "x", startsAt: "y" }, { kind: "MEETING", title: "x", startsAt: "y" }, { kind: "EVENT", title: 3, startsAt: "y" }]) assert.equal(fromThreadPayload(junk), null);
});

test("a card says when: day, time, and the place or the length", () => {
  const when = new Date(2026, 9, 9, 14, 30).toISOString();
  assert.match(cardWhen({ type: "event", startsAt: when, place: "Roma" }, "en-US"), /^Fri, Oct 9, 2:30\s?PM · Roma$/);
  assert.match(cardWhen({ type: "meeting", startsAt: when, durationMinutes: 45 }, "en-US"), /· 45 min$/);
  assert.match(cardWhen({ type: "meeting", startsAt: when, durationMinutes: 120 }, "en-US"), /· 2 h$/);
  assert.equal(cardWhen({ type: "event", startsAt: "nonsense" }), "");
});

test("map helpers: a pin must be on the map, and the view centres on the pins", () => {
  assert.equal(canSendPin({ latitude: 40, longitude: -75, label: "Site" }), true);
  assert.equal(canSendPin({ latitude: 91, longitude: 0, label: "x" }), false);
  assert.equal(canSendPin({ latitude: Number.NaN, longitude: 0, label: "x" }), false);
  assert.equal(canSendPin(undefined), false);
  assert.deepEqual(regionFor([{ latitude: 10, longitude: 20, label: "a" }, { latitude: 20, longitude: 40, label: "b" }]), { latitude: 15, longitude: 30, latitudeDelta: 0.08, longitudeDelta: 0.08 });
  assert.equal(regionFor([]).latitudeDelta, 40);
});

// ---- through the service, against a stubbed network ------------------------------------------------------------

const a = "00000000-0000-4000-8000-0000000000a1";
const b = "00000000-0000-4000-8000-0000000000b2";
const conv = "00000000-0000-4000-8000-000000000003";
function stubFetch(handler: (url: string, init?: RequestInit) => unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return { ok: status < 400, status, text: async () => JSON.stringify(url.endsWith('/visibility')?{visibleMessageIds:JSON.parse(String(init?.body)).messageIds}:handler(url, init)) } as unknown as Response;
  };
  return calls;
}
const svc = (secure?: SecureMessaging) => new ConversationService("https://api.test", async () => "tok", a, secure);
const fakeSecure = (): SecureMessaging => ({
  async seal(p: string) { return Buffer.from("sealed:" + p, "utf8").toString("base64"); },
  async open(c: string) { return Buffer.from(c, "base64").toString("utf8").replace(/^sealed:/, ""); }
});

test("an event is sealed in the pack's form and posted to the attachments endpoint, never as a plain message", async () => {
  const calls = stubFetch(() => ({ id: "x", accepted: true }));
  const id = "11111111-1111-4111-8111-111111111111";
  const row = await svc(fakeSecure()).send(conv, { type: "event", title: "Dinner", startsAt: "2026-10-09T18:00:00.000Z", place: "Roma" }, id);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/v2\/chats\/[^/]+\/attachments$/);
  const body = JSON.parse(String(calls[0]!.init!.body));
  assert.deepEqual(Object.keys(body).sort(), ["envelopeBase64", "id", "kind"]);
  assert.equal(body.id, id);
  assert.equal(body.kind, "EVENT");
  assert.match(body.envelopeBase64, /^[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(body).includes("Dinner"), false);
  assert.equal(row.id, id);
});

test("an event or meeting cannot be sent while secure messaging is missing", async () => {
  const calls = stubFetch(() => ({}));
  await assert.rejects(svc().send(conv, { type: "meeting", title: "Sync", startsAt: "2026-10-09T18:00:00.000Z", durationMinutes: 30 }, "22222222-2222-4222-8222-222222222222"), /SECURE_CORE_UNAVAILABLE/);
  assert.equal(calls.length, 0);
});

test("history brings events and meetings along, opened into cards; other attachment kinds are left alone", async () => {
  const sealedMeeting = Buffer.from("sealed:" + JSON.stringify({ kind: "MEETING", title: "Sync", startsAt: "2026-10-09T18:00:00.000Z", durationMinutes: 30 }), "utf8").toString("base64url");
  stubFetch((url) => url.includes("/attachments") ? { attachments: [
    { id: "att-1", kind: "MEETING", senderUserId: b, envelopeBase64: sealedMeeting, createdAt: "2026-01-01T10:05:00Z" },
    { id: "att-2", kind: "VOICE", senderUserId: b, envelopeBase64: sealedMeeting, createdAt: "2026-01-01T10:06:00Z" }
  ] } : { messages: [], nextCursor: null });
  const service = svc(fakeSecure());
  const page = await service.loadHistory(conv);
  assert.deepEqual(page.rows.map((r) => r.id), ["att-1"]);
  const [opened] = await service.decryptServerRows(conv, page.rows);
  assert.equal(opened!.ok, true);
  assert.deepEqual(JSON.parse((opened as { text: string }).text), { type: "meeting", title: "Sync", startsAt: "2026-10-09T18:00:00.000Z", durationMinutes: 30 });
});

test("if the attachments cannot be fetched the messages still load", async () => {
  stubFetch((url) => { if (url.includes("/attachments")) throw new Error("down"); if(url.endsWith('/visibility'))return {visibleMessageIds:['m1']};return { messages: [{ id: "m1", senderUserId: b, ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==", createdAt: "2026-01-01T10:00:00Z", kind: "TEXT" }], nextCursor: null }; });
  const page = await svc(fakeSecure()).loadHistory(conv);
  assert.deepEqual(page.rows.map((r) => r.id), ["m1"]);
});

test("location requests go to the server without any coordinates; sharing seals them first and declining needs no seal", async () => {
  const calls = stubFetch(() => ({ id: "x", state: "REQUESTED" }));
  const share = "33333333-3333-4333-8333-333333333333";
  await svc().requestLocation(conv, b, share);
  assert.match(calls[0]!.url, /\/location-requests$/);
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { id: share, peerUserId: b });
  await svc().declineLocation(share);
  assert.deepEqual(JSON.parse(String(calls[1]!.init!.body)), { accept: false });
  await svc(fakeSecure()).shareLocation({ shareId: share, conversationId: conv, label: "Site", latitude: 40.1, longitude: -75.2, minutes: 30 });
  const body = JSON.parse(String(calls[2]!.init!.body));
  assert.equal(body.accept, true);
  assert.equal(JSON.stringify(body).includes("40.1"), false);
  assert.ok(Date.parse(body.expiresAt) > Date.now());
  await assert.rejects(svc().shareLocation({ shareId: share, conversationId: conv, label: "x", latitude: 40, longitude: 1, minutes: 5 }), /SECURE_CORE_UNAVAILABLE/);
  await assert.rejects(svc(fakeSecure()).shareLocation({ shareId: share, conversationId: conv, label: "x", latitude: 99, longitude: 1, minutes: 5 }), /LOCATION_INVALID/);
  await assert.rejects(svc(fakeSecure()).shareLocation({ shareId: share, conversationId: conv, label: "x", latitude: 1, longitude: 1, minutes: 600 }), /LOCATION_INVALID/);
});

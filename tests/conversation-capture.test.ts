import test from "node:test";
import assert from "node:assert/strict";
import { ACCESS_FOR, ThreadAccessGate, accessDeniedMessage, accessNames, deniedAccessPrompt, designFileAllowed, type AccessPrompt, type AccessState, type DeviceAccess } from "../clients/mobile/services/conversation-access.ts";
import { CaptureActivation } from "../clients/mobile/services/capture-activation.ts";
import { unavailableReason } from "../clients/mobile/services/conversation-thread.ts";
import { ConversationService, type SecureMessaging } from "../clients/mobile/services/conversation.service.ts";

const prompt = (answers: Partial<Record<DeviceAccess, AccessState>>): AccessPrompt & { asked: DeviceAccess[] } => {
  const asked: DeviceAccess[] = [];
  return { asked, async request(access) { asked.push(access); return answers[access] ?? "DENIED"; } };
};

test("each action asks for the device access the pack lists, and Poll, Event and Meeting ask for none", () => {
  assert.deepEqual(ACCESS_FOR.PHOTO, ["CAMERA", "PHOTOS"]);
  assert.deepEqual(ACCESS_FOR.VIDEO, ["CAMERA", "MICROPHONE"]);
  assert.deepEqual(ACCESS_FOR.VOICE, ["MICROPHONE"]);
  assert.deepEqual(ACCESS_FOR.DOCUMENT, ["FILES"]);
  assert.deepEqual(ACCESS_FOR.DESIGN, ["PHOTOS", "FILES"]);
  assert.deepEqual(ACCESS_FOR.CONTACT, ["CONTACTS"]);
  assert.deepEqual(ACCESS_FOR.LOCATION, ["LOCATION"]);
  assert.deepEqual(ACCESS_FOR.LIVE_SCREEN, ["SCREEN"]);
  for (const none of ["POLL", "EVENT", "MEETING", "AI_IMAGE"]) assert.equal(none in ACCESS_FOR, false, none);
});

test("access is asked in order and stops at the first one that is not granted", async () => {
  const p = prompt({ CAMERA: "GRANTED", PHOTOS: "DENIED" });
  assert.deepEqual(await new ThreadAccessGate(p).allow("PHOTO"), { ok: false, missing: "PHOTOS" });
  const stopsEarly = prompt({ CAMERA: "DENIED", MICROPHONE: "GRANTED" });
  assert.deepEqual(await new ThreadAccessGate(stopsEarly).allow("VIDEO"), { ok: false, missing: "CAMERA" });
  assert.deepEqual(stopsEarly.asked, ["CAMERA"]);
  assert.deepEqual(await new ThreadAccessGate(prompt({ CAMERA: "GRANTED", MICROPHONE: "GRANTED" })).allow("VIDEO"), { ok: true });
});

test("anything but a grant fails closed: undetermined, denied and a prompt that throws", async () => {
  assert.deepEqual(await new ThreadAccessGate(prompt({ LOCATION: "UNDETERMINED" })).allow("LOCATION"), { ok: false, missing: "LOCATION" });
  assert.deepEqual(await new ThreadAccessGate({ async request() { throw new Error("boom"); } }).allow("VOICE"), { ok: false, missing: "MICROPHONE" });
  assert.deepEqual(await new ThreadAccessGate(deniedAccessPrompt).allow("DOCUMENT"), { ok: false, missing: "FILES" });
});

test("Design takes a photo, a PDF or a Word document and nothing else", () => {
  for (const ok of ["image/jpeg", "image/png", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "IMAGE/PNG", "application/pdf; charset=binary"]) assert.equal(designFileAllowed(ok), true, ok);
  for (const bad of ["image/gif", "image/svg+xml", "text/html", "application/zip", "application/msword", "video/mp4", "", "application/pdfx"]) assert.equal(designFileAllowed(bad), false, bad);
});

test("Design checks the access first, then the file type", async () => {
  const granted = new CaptureActivation(prompt({ PHOTOS: "GRANTED", FILES: "GRANTED" }));
  assert.deepEqual(await granted.design("application/pdf"), { ok: true });
  assert.deepEqual(await granted.design("image/gif"), { ok: false, missing: "FILES", reason: "DESIGN_TYPE_REJECTED" });
  assert.deepEqual(await new CaptureActivation(prompt({ PHOTOS: "DENIED" })).design("application/pdf"), { ok: false, missing: "PHOTOS" });
});

test("the words for what is missing", () => {
  assert.equal(accessNames("PHOTO"), "camera and photo");
  assert.equal(accessNames("VOICE"), "microphone");
  assert.equal(accessNames("LIVE_SCREEN"), "screen capture");
  assert.match(accessDeniedMessage("CAMERA"), /camera access/);
});

test("in this build the not-yet actions name the access they need; Poll, Event and Meeting need none", () => {
  assert.match(unavailableReason("PHOTO") ?? "", /camera and photo access/);
  assert.match(unavailableReason("VIDEO") ?? "", /camera and microphone access.*ask first/);
  assert.match(unavailableReason("DOCUMENT") ?? "", /file access/);
  assert.match(unavailableReason("LIVE_SCREEN") ?? "", /screen capture access.*ask first/);
  assert.match(unavailableReason("AI_IMAGE") ?? "", /Not available/);
  for (const id of ["POLL", "EVENT", "MEETING"] as const) assert.equal(unavailableReason(id), null);
});

// ---- live screen, through the service against a stubbed network ----------------------------------------------------

const a = "00000000-0000-4000-8000-0000000000a1";
const conv = "00000000-0000-4000-8000-000000000003";
function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return { ok: true, status: 200, text: async () => JSON.stringify(handler(url, init)) } as unknown as Response;
  };
  return calls;
}
const seal: SecureMessaging = { async seal(p: string) { return Buffer.from("sealed:" + p).toString("base64"); }, async open() { return ""; } };
const svc = (secure?: SecureMessaging) => new ConversationService("https://api.test", async () => "tok", a, secure);
const SESSION = "44444444-4444-4444-8444-444444444444";

test("no screen offer is sent unless access is granted", async () => {
  const calls = stubFetch(() => ({ id: SESSION, state: "OFFERED" }));
  const denied = new CaptureActivation(prompt({ SCREEN: "DENIED" }), svc(seal), () => SESSION);
  assert.deepEqual(await denied.offerScreen(conv), { ok: false, missing: "SCREEN" });
  assert.equal(calls.length, 0);
  const granted = new CaptureActivation(prompt({ SCREEN: "GRANTED" }), svc(seal), () => SESSION);
  assert.deepEqual(await granted.offerScreen(conv), { ok: true, id: SESSION });
  assert.equal(calls.length, 1);
});

test("a screen offer is sealed and posted as base64url, with only the id and the envelope in the request", async () => {
  const calls = stubFetch(() => ({ id: SESSION, state: "OFFERED" }));
  await svc(seal).offerScreen(conv, SESSION);
  assert.match(calls[0]!.url, /\/v2\/chats\/[^/]+\/screen-shares$/);
  const body = JSON.parse(String(calls[0]!.init!.body));
  assert.deepEqual(Object.keys(body).sort(), ["id", "offerEnvelopeBase64"]);
  assert.match(body.offerEnvelopeBase64, /^[A-Za-z0-9_-]+$/);
  assert.equal(body.id, SESSION);
  assert.equal(Buffer.from(body.offerEnvelopeBase64, "base64url").toString().startsWith("sealed:"), true);
});

test("with no secure messaging a screen offer is refused before anything is sent", async () => {
  const calls = stubFetch(() => ({}));
  await assert.rejects(svc().offerScreen(conv, SESSION), /SECURE_CORE_UNAVAILABLE/);
  await assert.rejects(svc().answerScreen(conv, SESSION, true), /SECURE_CORE_UNAVAILABLE/);
  assert.equal(calls.length, 0);
});

test("declining needs no seal; accepting seals an answer; stop and look go to the right places", async () => {
  const calls = stubFetch((url) => url.endsWith("/screen-shares") ? { session: null } : { id: SESSION, state: "DECLINED" });
  await svc().answerScreen(conv, SESSION, false);
  assert.match(calls[0]!.url, new RegExp(`/v2/screen-shares/${SESSION}/answer$`));
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { accept: false });
  await svc(seal).answerScreen(conv, SESSION, true);
  const accepted = JSON.parse(String(calls[1]!.init!.body));
  assert.equal(accepted.accept, true);
  assert.match(accepted.answerEnvelopeBase64, /^[A-Za-z0-9_-]+$/);
  await svc().stopScreen(SESSION);
  assert.match(calls[2]!.url, new RegExp(`/v2/screen-shares/${SESSION}/stop$`));
  assert.equal(await svc().screenShare(conv), null);
  assert.match(calls[3]!.url, /\/v2\/chats\/[^/]+\/screen-shares$/);
});

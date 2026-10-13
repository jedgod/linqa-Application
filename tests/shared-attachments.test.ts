import test from "node:test";
import assert from "node:assert/strict";
import { buildSharedAttachment, sharedAttachmentUrl } from "../clients/mobile/services/shared-attachment.ts";
import { validatePayload } from "../clients/mobile/services/conversation-engine.ts";
import { buildTimeline } from "../clients/mobile/services/conversation-state.ts";
import { ConversationService, type SecureMessaging } from "../clients/mobile/services/conversation.service.ts";

const self = "00000000-0000-4000-8000-000000000001";
const thread = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const contact = buildSharedAttachment("CONTACT", { title: " Ama ", phone: "+1 301 555 0100", role: "Manager" });
const location = buildSharedAttachment("LOCATION", { title: "North gate", latitude: "38.95", longitude: "-76.86", address: "Site entrance" });

test("shares require real fields, valid coordinates, and bounded contact details", () => {
  assert.equal(contact.title, "Ama");
  for (const fields of [{ title: "Gate", latitude: "", longitude: "0" }, { title: "Gate", latitude: "91", longitude: "0" }, { title: "Gate", latitude: "0", longitude: "181" }]) assert.throws(() => buildSharedAttachment("LOCATION", fields));
  assert.throws(() => buildSharedAttachment("CONTACT", { title: "Ama" }));
  assert.throws(() => buildSharedAttachment("CONTACT", { title: "Ama", phone: "javascript:alert(1)" }));
  assert.throws(() => validatePayload({ ...contact, role: "x".repeat(121) }));
  assert.equal(sharedAttachmentUrl(location), "https://www.google.com/maps/search/?api=1&query=38.95,-76.86");
  assert.equal(sharedAttachmentUrl(contact), "tel:%2B13015550100");
});

test("shared cards appear in the thread and become sealed when the gate is closed", () => {
  const message = { id, senderId: self, sentAt: "2026-10-09T10:00:00Z", outgoing: true, body: { state: "open" as const, payload: contact } };
  assert.equal(buildTimeline([message], "All")[0]?.kind, "share");
  assert.equal(buildTimeline([{ ...message, body: { state: "sealed" } }], "All")[0]?.kind, "closed");
});

test("contact and location use sealed relay envelopes, round trip, and reuse ciphertext on retry", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  let seals = 0;
  const secure: SecureMessaging = {
    async seal(text) { seals++; return Buffer.from("sealed:" + text).toString("base64"); },
    async open(bytes) { return Buffer.from(bytes, "base64").toString().slice(7); }
  };
  let attachment: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), body });
    if(String(url).endsWith('/visibility'))return {ok:true,status:200,text:async()=>JSON.stringify({visibleMessageIds:body.messageIds})} as Response;
    if (body) attachment = body;
    return { ok: true, status: 200, text: async () => JSON.stringify(body ? { id, accepted: true } : String(url).includes("attachments") ? { attachments: [{ ...attachment, createdAt: "2026-10-09T10:00:00Z", senderUserId: self }] } : { messages: [], nextCursor: null }) } as Response;
  };
  try {
    const service = new ConversationService("https://api.test", async () => "token", self, secure);
    for (const [index, payload] of [contact, location].entries()) {
      const messageId = index === 0 ? id : "00000000-0000-4000-8000-000000000004";
      await service.send(thread, payload, messageId);
      await service.send(thread, payload, messageId);
      const sent = calls.filter(call => call.body).at(-1)!;
      assert.deepEqual(Object.keys(sent.body!).sort(), ["envelopeBase64", "id", "kind"]);
      assert.equal(JSON.stringify(sent.body).includes(payload.title), false);
      const page = await service.loadHistory(thread);
      const [opened] = await service.decryptServerRows(thread, page.rows);
      assert.equal(opened?.ok, true);
      if (opened?.ok) assert.deepEqual(JSON.parse(opened.text), JSON.parse(JSON.stringify(payload)));
    }
    assert.equal(seals, 2);
    await assert.rejects(service.send(thread, location, id), /ATTACHMENT_ID_TAKEN/);
    const count = calls.length;
    await assert.rejects(new ConversationService("https://api.test", async () => "token", self).send(thread, contact, id), /SECURE_CORE_UNAVAILABLE/);
    assert.equal(calls.length, count);
  } finally { globalThis.fetch = originalFetch; }
});

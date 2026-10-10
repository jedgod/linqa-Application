import test from "node:test";
import assert from "node:assert/strict";
import { ConversationService, assertSendableCiphertext, MAX_SEALED_BYTES, type SecureMessaging } from "../clients/mobile/services/conversation.service.ts";
import type { SealedTextOutbox } from "../clients/mobile/services/sealed-text-outbox.ts";
import { createRejectedOutbox } from "../clients/mobile/services/rejected-outbox.ts";

const self = "00000000-0000-4000-8000-000000000001";
const conv = "00000000-0000-4000-8000-000000000003";
const sealedOk = Buffer.from("sealed-bundle-bytes-0123456789").toString("base64");

function memoryOutbox(): SealedTextOutbox & { rows: Map<string, { conversationId: string; ciphertext: string }>; failed: Map<string, { conversationId: string; code: string }> } {
  const rows = new Map<string, { conversationId: string; ciphertext: string }>();
  const failed = new Map<string, { conversationId: string; code: string }>();
  const failures = createRejectedOutbox({
    async markPermanent(s, id, code) { const r = rows.get(id); if (!r) throw new Error("NOT_FOUND"); failed.set(id, { conversationId: s.conversationId, code }); rows.delete(id); },
    async listPermanent() { return []; },
    async deletePermanent() {}
  }, "acct");
  return {
    rows, failed, failures,
    async find(id) { return rows.get(id)?.ciphertext ?? null; },
    async put(id, conversationId, ciphertext) { rows.set(id, { conversationId, ciphertext }); },
    async remove(id) { rows.delete(id); },
    async pending() { return [...rows].map(([messageId, r]) => ({ messageId, ...r })); }
  };
}
const secure = (out: string): SecureMessaging => ({ async seal() { return out; }, async open() { return ""; } });
const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

test("ciphertext check mirrors the relay: base64 only, non-trivial, size capped", () => {
  assert.doesNotThrow(() => assertSendableCiphertext(sealedOk));
  assert.throws(() => assertSendableCiphertext("not base64!!!!!!!!!"), /INVALID_CIPHERTEXT/);
  assert.throws(() => assertSendableCiphertext("QQ=="), /INVALID_CIPHERTEXT/);
  assert.throws(() => assertSendableCiphertext(Buffer.alloc(MAX_SEALED_BYTES + 1).toString("base64")), /BATCH_TOO_LARGE/);
  assert.doesNotThrow(() => assertSendableCiphertext(Buffer.alloc(MAX_SEALED_BYTES).toString("base64")));
});

test("an unsendable sealed bundle is never queued", async () => {
  const out = memoryOutbox();
  const svc = new ConversationService("https://x", async () => "t", self, secure("bad!"), undefined, undefined, out);
  await assert.rejects(svc.send(conv, { type: "text", text: "hi", lane: "General" }, "m1"), /INVALID_CIPHERTEXT/);
  assert.equal(out.rows.size, 0);
});

test("flush keeps rows on outage and on non-definite refusals; a definite refusal is kept as failed and reported", async () => {
  const out = memoryOutbox();
  await out.put("a", conv, sealedOk); await out.put("b", conv, sealedOk);
  const svc = new ConversationService("https://x", async () => "t", self, secure(sealedOk), undefined, undefined, out);
  const real = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.deepEqual(await svc.flushOutbox(), []);
    assert.equal(out.rows.size, 2);

    // 409 / 401 are not proof the message can never be sent: keep it and stop.
    globalThis.fetch = respond(409, { code: "DEVICE_SET_CHANGED" }) as unknown as typeof fetch;
    assert.deepEqual(await svc.flushOutbox(), []);
    assert.equal(out.rows.size, 2);

    let n = 0;
    globalThis.fetch = (async () => (n++ === 0 ? respond(422, { error: { code: "CIPHERTEXT_NOT_BASE64" } })() : respond(200, { id: "srv" })())) as typeof fetch;
    const rejected: string[] = [];
    const accepted = await svc.flushOutbox((id, code) => rejected.push(`${id}:${code}`));
    assert.deepEqual(rejected, ["a:CIPHERTEXT_NOT_BASE64"]);
    assert.deepEqual(accepted, ["b"]);
    assert.deepEqual([...out.failed.keys()], ["a"]);
    assert.equal(out.rows.has("b"), false);
  } finally { globalThis.fetch = real; }
});

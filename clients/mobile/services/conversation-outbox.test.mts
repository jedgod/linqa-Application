import assert from "node:assert/strict";
import { ConversationService } from "./conversation.service";
import { sealedTextOutbox } from "./sealed-text-outbox";
import type { MobileOutboxDb, MobileOutboxRow } from "../src/messaging/outbox";

const conv = "00000000-0000-4000-8000-000000000003";
const id = "00000000-0000-4000-8000-000000000004";
const me = "00000000-0000-4000-8000-000000000001";

function memoryDb(): MobileOutboxDb & { rows: Map<string, MobileOutboxRow> } {
  const rows = new Map<string, MobileOutboxRow>();
  return {
    rows,
    transaction: (fn) => fn(),
    insert: async (r) => { if (rows.has(r.messageId)) throw new Error("UNIQUE"); rows.set(r.messageId, r); },
    due: async () => [...rows.values()],
    find: async (m) => rows.get(m) ?? null,
    pending: async () => [...rows.values()],
    remove: async (m) => { rows.delete(m); },
    update: async () => {}
  };
}

function fixture(responses: Array<number | "network">) {
  const db = memoryDb();
  let seals = 0;
  const posted: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const next = responses.shift() ?? 201;
    posted.push(JSON.parse(init.body).ciphertext);
    if (next === "network") throw new TypeError("offline");
    return new Response(next < 300 ? JSON.stringify({ id: "m1" }) : JSON.stringify({ error: { code: "REFUSED" } }), { status: next });
  }) as unknown as typeof fetch;
  const secure = { seal: async () => `sealed-${++seals}`, open: async () => "x" };
  const service = new ConversationService("https://api.test", async () => "t", me, secure, undefined, undefined, sealedTextOutbox(db, me));
  return { db, service, posted, get seals() { return seals; }, restore: () => { globalThis.fetch = realFetch; } };
}

const text = { type: "text", text: "hi" } as never;

test("accepted message leaves nothing in the outbox", async () => {
  const f = fixture([201]);
  try { await f.service.send(conv, text, id); assert.equal(f.db.rows.size, 0); } finally { f.restore(); }
});

test("offline send keeps the sealed bytes; retry reuses them without sealing again", async () => {
  const f = fixture(["network", 201]);
  try {
    await assert.rejects(f.service.send(conv, text, id), /NETWORK/);
    assert.equal(f.db.rows.size, 1);
    assert.equal(JSON.stringify([...f.db.rows.values()]).includes("hi"), false);
    await f.service.send(conv, text, id);
    assert.deepEqual(f.posted, ["sealed-1", "sealed-1"]);
    assert.equal(f.seals, 1);
    assert.equal(f.db.rows.size, 0);
  } finally { f.restore(); }
});

test("a definite refusal drops the row", async () => {
  const f = fixture([403]);
  try { await assert.rejects(f.service.send(conv, text, id)); assert.equal(f.db.rows.size, 0); } finally { f.restore(); }
});

test("flushOutbox resends left-over rows and clears them", async () => {
  const f = fixture(["network", 201]);
  try {
    await assert.rejects(f.service.send(conv, text, id));
    assert.deepEqual(await f.service.flushOutbox(), [id]);
    assert.equal(f.db.rows.size, 0);
    assert.equal(f.seals, 1);
  } finally { f.restore(); }
});

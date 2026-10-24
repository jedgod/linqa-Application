import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFS, THEMES, conversationError, resolveTheme, inLane, parseBody, parsePrefs, projectMessages, timeLabel, validatePayload, voteCount, type OpenedMessage, type Payload } from "../clients/mobile/services/conversation-engine.ts";
import { ConversationService, type SecureMessaging } from "../clients/mobile/services/conversation.service.ts";
import { createMessagingGate } from "../clients/mobile/services/conversation-gate.ts";
import { buildDecisions, buildMessages, buildTimeline, mergeRows, startsNewRun } from "../clients/mobile/services/conversation-state.ts";
import { isSecureCoreError, type DisplayMessage, type ServerRow } from "../clients/mobile/services/conversation-types.ts";

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const conv = "00000000-0000-4000-8000-000000000003";
const msg = (id: string, sender: string, at: string, payload: Payload): OpenedMessage => ({ id, senderUserId: sender, ciphertext: "x", createdAt: at, kind: "TEXT", payload });

test("payload rules: text, decision and vote", () => {
  assert.doesNotThrow(() => validatePayload({ type: "text", text: "hi", lane: "Plans" }));
  assert.throws(() => validatePayload({ type: "text", text: "  ", lane: "General" }));
  assert.throws(() => validatePayload({ type: "text", text: "x".repeat(8001), lane: "General" }));
  assert.throws(() => validatePayload({ type: "text", text: "hi", lane: "Secret" }));
  assert.throws(() => validatePayload({ type: "decision", title: "x", options: ["same", "same"] }));
  assert.throws(() => validatePayload({ type: "decision", title: "x", options: ["only one"] }));
  assert.throws(() => validatePayload({ type: "decision", title: "x", options: ["1", "2", "3", "4", "5", "6"] }));
  assert.doesNotThrow(() => validatePayload({ type: "decision", title: "When?", options: ["3 PM", "4 PM"] }));
  assert.throws(() => validatePayload({ type: "vote", boardId: "b", choice: 5 }));
  assert.throws(() => validatePayload({ type: "vote", boardId: "", choice: 0 }));
  assert.throws(() => validatePayload({ type: "photo" }));
  assert.throws(() => validatePayload(null));
});

test("one vote per person, the latest wins, out-of-range and unknown boards are ignored", () => {
  const rows = projectMessages([
    msg("board", a, "2026-01-01T10:00:00Z", { type: "decision", title: "When?", options: ["3 PM", "4 PM"] }),
    msg("v1", a, "2026-01-01T10:01:00Z", { type: "vote", boardId: "board", choice: 0 }),
    msg("v2", a, "2026-01-01T10:02:00Z", { type: "vote", boardId: "board", choice: 1 }),
    msg("v3", b, "2026-01-01T10:03:00Z", { type: "vote", boardId: "board", choice: 0 }),
    msg("v4", b, "2026-01-01T10:04:00Z", { type: "vote", boardId: "board", choice: 4 }),
    msg("v5", b, "2026-01-01T10:05:00Z", { type: "vote", boardId: "nope", choice: 1 })
  ]);
  assert.equal(rows.length, 1);
  const board = rows[0] as Extract<(typeof rows)[number], { payload: { type: "decision" } }>;
  assert.deepEqual(board.votes, { [a]: 1, [b]: 0 });
  assert.equal(voteCount(board, 0), 1);
  assert.equal(voteCount(board, 1), 1);
});

test("order does not depend on arrival order, and ties break by id", () => {
  const rows = projectMessages([
    msg("m2", a, "2026-01-01T10:00:00Z", { type: "text", text: "second", lane: "General" }),
    msg("m1", a, "2026-01-01T10:00:00Z", { type: "text", text: "first", lane: "General" }),
    msg("m0", b, "2025-12-31T09:00:00Z", { type: "text", text: "earliest", lane: "General" })
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["m0", "m1", "m2"]);
});

test("lanes: Plans and Ideas show their own text and every decision board; All shows everything", () => {
  const rows = projectMessages([
    msg("p", a, "2026-01-01T10:00:00Z", { type: "text", text: "plan", lane: "Plans" }),
    msg("i", a, "2026-01-01T10:01:00Z", { type: "text", text: "idea", lane: "Ideas" }),
    msg("g", a, "2026-01-01T10:02:00Z", { type: "text", text: "hello", lane: "General" }),
    msg("d", a, "2026-01-01T10:03:00Z", { type: "decision", title: "Where?", options: ["A", "B"] })
  ]);
  const ids = (lane: "All" | "Plans" | "Ideas") => rows.filter((r) => inLane(r, lane)).map((r) => r.id);
  assert.deepEqual(ids("All"), ["p", "i", "g", "d"]);
  assert.deepEqual(ids("Plans"), ["p", "d"]);
  assert.deepEqual(ids("Ideas"), ["i", "d"]);
});

test("themes: light and dark define every colour; the person can follow the phone or pick one", () => {
  assert.deepEqual(Object.keys(THEMES), ["light", "dark"]);
  for (const t of Object.values(THEMES)) for (const v of Object.values(t)) assert.match(v, /^#[0-9A-F]{6}$/i);
  assert.equal(resolveTheme("light", "dark"), THEMES.light);
  assert.equal(resolveTheme("dark", "light"), THEMES.dark);
  assert.equal(resolveTheme("system", "dark"), THEMES.dark);
  assert.equal(resolveTheme("system", "light"), THEMES.light);
  assert.equal(resolveTheme("system", null), THEMES.light);
});

test("preferences fall back to the defaults for anything unreadable, including the older colour themes", () => {
  assert.deepEqual({ ...DEFAULT_PREFS, features: [] }, { theme: "dark", quiet: false, verified: false, features: [], background: "AUTO" });
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs("not json"), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs(JSON.stringify({ theme: "neon", quiet: "yes", verified: 1 })), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs(JSON.stringify({ theme: "midnight", quiet: true })), { ...DEFAULT_PREFS, theme: "dark", quiet: true });
  assert.deepEqual(parsePrefs(JSON.stringify({ theme: "dark", quiet: true, verified: true })), { ...DEFAULT_PREFS, theme: "dark", quiet: true, verified: true });
});

test("error text hides server codes", () => {
  assert.match(conversationError("CONVERSATION_NOT_FOUND"), /no longer available/);
  assert.match(conversationError("NETWORK"), /connection/i);
  assert.equal(conversationError("42P08"), conversationError(undefined));
  assert.doesNotMatch(conversationError("HTTP_500"), /500/);
});

test("times read like a chat", () => {
  const now = new Date("2026-03-10T12:00:00");
  assert.match(timeLabel("2026-03-10T09:05:00", now), /9:05/);
  assert.match(timeLabel("2026-03-01T09:05:00", now), /·/);
  assert.equal(timeLabel("garbage", now), "");
});


test("a decrypted body is a payload; older plain text is a General message; junk JSON is plain text, never a crash", () => {
  assert.deepEqual(parseBody(JSON.stringify({ type: "text", text: "hi", lane: "Ideas" })), { type: "text", text: "hi", lane: "Ideas" });
  assert.deepEqual(parseBody("just words"), { type: "text", text: "just words", lane: "General" });
  assert.deepEqual(parseBody('{"type":"script"}'), { type: "text", text: '{"type":"script"}', lane: "General" });
  assert.equal(parseBody("   "), null);
  assert.equal(parseBody("x".repeat(8001)), null);
});

// ---- the gate ---------------------------------------------------------------------------------------------

const ready = { "secure-core": { state: "READY" }, "message-relay": { state: "READY" }, "key-transparency": { state: "READY" } } as never;
const core = (over: Partial<Record<"version" | "protectionLevel", () => Promise<unknown>>> = {}) =>
  ({ version: async () => "1", protectionLevel: async () => "OS_PROTECTED", ...over }) as never;

test("gate: no native secure core means LOCKED, and nothing else is even asked", async () => {
  let asked = false;
  const gate = createMessagingGate({ core: null, capabilities: async () => { asked = true; return ready; } });
  assert.deepEqual(await gate.evaluate(), { mode: "LOCKED", reason: "SECURE_CORE_UNAVAILABLE" });
  assert.equal(asked, false);
});

test("gate: LIVE only when the core answers and the server says every required capability is ready", async () => {
  assert.deepEqual(await createMessagingGate({ core: core(), capabilities: async () => ready }).evaluate(), { mode: "LIVE" });
});

test("gate: any failure locks it", async () => {
  const boom = async () => { throw new Error("boom"); };
  assert.deepEqual(await createMessagingGate({ core: core({ version: boom }), capabilities: async () => ready }).evaluate(), { mode: "LOCKED", reason: "PROBE_FAILED" });
  assert.deepEqual(await createMessagingGate({ core: core({ protectionLevel: boom }), capabilities: async () => ready }).evaluate(), { mode: "LOCKED", reason: "PROBE_FAILED" });
  assert.deepEqual(await createMessagingGate({ core: core(), capabilities: boom as never }).evaluate(), { mode: "LOCKED", reason: "PROBE_FAILED" });
  for (const missing of ["secure-core", "message-relay", "key-transparency"]) {
    const caps = { ...(ready as object), [missing]: { state: "DEGRADED" } } as never;
    assert.deepEqual(await createMessagingGate({ core: core(), capabilities: async () => caps }).evaluate(), { mode: "LOCKED", reason: "NOT_READY" }, missing);
  }
  assert.deepEqual(await createMessagingGate({ core: core(), capabilities: async () => ({}) as never }).evaluate(), { mode: "LOCKED", reason: "NOT_READY" });
});

// ---- what the screen lists --------------------------------------------------------------------------------

const row = (id: string, sender: string, at: string): ServerRow => ({ id, senderId: sender, sentAt: at, ciphertext: "c" + id });
const rows = [row("m1", b, "2026-10-06T14:00:00Z"), row("m2", a, "2026-10-06T14:01:00Z"), row("m3", b, "2026-10-06T14:02:00Z")];
const opened = {
  m1: { state: "open", payload: { type: "text", text: "first", lane: "General" } },
  m2: { state: "open", payload: { type: "text", text: "plan this", lane: "Plans" } },
  m3: { state: "unreadable" }
} as const;
const unsent: DisplayMessage = { id: "local", senderId: a, sentAt: "2026-10-06T14:03:00Z", outgoing: true, body: { state: "open", payload: { type: "text", text: "typing", lane: "General" } }, delivery: "sending" };

test("not LIVE: every message is sealed, whatever was opened before, and nothing the person typed is shown", () => {
  const messages = buildMessages({ live: false, rows, opened: opened as never, pending: [unsent], selfId: a });
  assert.deepEqual(messages.map((m) => m.body.state), ["sealed", "sealed", "sealed"]);
  assert.equal(JSON.stringify(messages).includes("first"), false);
  assert.equal(JSON.stringify(messages).includes("typing"), false);
});

test("LIVE: newest first, own messages marked sent, unsent ones first, unopened rows stay sealed", () => {
  const messages = buildMessages({ live: true, rows: [...rows, row("m4", b, "2026-10-06T14:04:00Z")], opened: opened as never, pending: [unsent], selfId: a });
  assert.deepEqual(messages.map((m) => m.id), ["m4", "local", "m3", "m2", "m1"]);
  assert.equal(messages.find((m) => m.id === "m4")!.body.state, "sealed");
  assert.equal(messages.find((m) => m.id === "m2")!.delivery, "sent");
  assert.equal(messages.find((m) => m.id === "m1")!.delivery, undefined);
});

test("timeline: lanes, sealed and unreadable only under All, votes folded into the board and not listed", () => {
  const board: ServerRow = row("board", b, "2026-10-06T14:05:00Z");
  const voteRow: ServerRow = row("v1", a, "2026-10-06T14:06:00Z");
  const messages = buildMessages({
    live: true, rows: [...rows, board, voteRow],
    opened: { ...opened, board: { state: "open", payload: { type: "decision", title: "Where?", options: ["A", "B"] } }, v1: { state: "open", payload: { type: "vote", boardId: "board", choice: 1 } } } as never,
    pending: [], selfId: a
  });
  const all = buildTimeline(messages, "All");
  assert.deepEqual(all.map((i) => i.kind), ["board", "closed", "text", "text"]);
  const boardItem = all[0] as Extract<(typeof all)[number], { kind: "board" }>;
  assert.deepEqual(boardItem.votes, { [a]: 1 });
  assert.deepEqual(buildTimeline(messages, "Plans").map((i) => i.message.id), ["board", "m2"]);
  assert.deepEqual(buildTimeline(messages, "Ideas").map((i) => i.message.id), ["board"]);
});

test("rows merge by id, oldest first; a time stamp appears under the last bubble of a run", () => {
  const merged = mergeRows([row("x", a, "2026-01-02T00:00:00Z")], [row("y", a, "2026-01-01T00:00:00Z"), { ...row("x", a, "2026-01-02T00:00:00Z"), ciphertext: "new" }]);
  assert.deepEqual(merged.map((r) => r.id), ["y", "x"]);
  assert.equal(merged[1]!.ciphertext, "new");
  const m = (id: string, sender: string, at: string) => ({ id, senderId: sender, sentAt: at, outgoing: false, body: { state: "sealed" } }) as DisplayMessage;
  assert.equal(startsNewRun(undefined, m("1", a, "2026-01-01T10:00:00Z")), true);
  assert.equal(startsNewRun(m("2", a, "2026-01-01T10:01:00Z"), m("1", a, "2026-01-01T10:00:00Z")), false);
  assert.equal(startsNewRun(m("2", b, "2026-01-01T10:01:00Z"), m("1", a, "2026-01-01T10:00:00Z")), true);
  assert.equal(startsNewRun(m("2", a, "2026-01-01T10:10:00Z"), m("1", a, "2026-01-01T10:00:00Z")), true);
});

// ---- the service, against a stubbed network ---------------------------------------------------------------

function stubFetch(handler: (url: string, init?: RequestInit) => unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return { ok: status < 400, status, text: async () => JSON.stringify(handler(url, init)) } as unknown as Response;
  };
  return calls;
}
const svc = (secure?: SecureMessaging) => new ConversationService("https://api.test", async () => "tok", a, secure);
const apiPage = { messages: [
  { id: "m1", senderUserId: b, ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==", createdAt: "2026-01-01T10:00:00Z", kind: "TEXT" },
  { id: "m2", senderUserId: a, ciphertext: null, createdAt: "2026-01-01T10:01:00Z", kind: "CALL" },
  { id: "m3", senderUserId: b, ciphertext: "BBBBBBBBBBBBBBBBBBBBBB==", createdAt: "2026-01-01T10:02:00Z", kind: "TEXT" }
], nextCursor: "c" };

test("history keeps only text messages with ciphertext and passes the cursor on", async () => {
  const calls = stubFetch((url) => url.endsWith('/visibility') ? {visibleMessageIds:['m1','m3']} : apiPage);
  const page = await svc().loadHistory(conv, "abc");
  assert.deepEqual(page.rows.map((r) => r.id), ["m1", "m3"]);
  assert.equal(page.nextCursor, "c");
  assert.match(calls[0]!.url, /cursor=abc/);
});

test("without a secure core nothing opens and nothing is sent, not even a request", async () => {
  const calls = stubFetch(() => ({}));
  await assert.rejects(svc().decryptServerRows(conv, [row("m1", b, "2026-01-01T10:00:00Z")]), (e) => isSecureCoreError(e));
  await assert.rejects(svc().send(conv, { type: "text", text: "secret words", lane: "General" }, "cid"), (e) => isSecureCoreError(e));
  assert.equal(calls.length, 0);
});

test("with a working core: sends carry only ciphertext and a stable client id; one bad row does not spoil the others", async () => {
  const secure: SecureMessaging = {
    async seal() { return "Q0lQSEVSVEVYVA=="; },
    async open(_c, ctx) { if (ctx.messageId === "bad") throw new Error("Signature invalid"); return "hello"; }
  };
  const calls = stubFetch(() => ({ id: "new", createdAt: "2026-01-01T11:00:00Z" }));
  const s = svc(secure);
  const sent = await s.send(conv, { type: "text", text: "secret words", lane: "Plans" }, "00000000-0000-4000-8000-0000000000bb");
  await s.send(conv, { type: "text", text: "secret words", lane: "Plans" }, "00000000-0000-4000-8000-0000000000bb");
  assert.equal(calls[0]!.init!.body, calls[1]!.init!.body);
  assert.equal(String(calls[0]!.init!.body).includes("secret words"), false);
  assert.equal(JSON.parse(String(calls[0]!.init!.body)).clientMessageId, "00000000-0000-4000-8000-0000000000bb");
  assert.deepEqual({ id: sent.id, senderId: sent.senderId }, { id: "new", senderId: a });
  const results = await s.decryptServerRows(conv, [row("ok", b, "2026-01-01T10:00:00Z"), row("bad", b, "2026-01-01T10:01:00Z")]);
  assert.deepEqual(results, [{ id: "ok", ok: true, text: "hello" }, { id: "bad", ok: false }]);
});

test("server and network failures surface as stable codes", async () => {
  stubFetch(() => ({ error: { code: "CONVERSATION_NOT_FOUND" } }), 404);
  await assert.rejects(svc().loadHistory(conv), /CONVERSATION_NOT_FOUND/);
  (globalThis as { fetch: unknown }).fetch = async () => { throw new TypeError("Network request failed"); };
  await assert.rejects(svc().loadHistory(conv), /^Error: NETWORK$/);
});

// ---- the Decisions page -----------------------------------------------------------------------------------

test("decisions: open until both people have voted, with whose turn it is, and the result once decided", () => {
  const board = (id: string, title: string, at: string): ServerRow => row(id, b, at);
  const rowsD = [board("d1", "Who books?", "2026-10-06T10:00:00Z"), board("d2", "Which plan?", "2026-10-06T10:01:00Z"), board("d3", "Lunch?", "2026-10-06T10:02:00Z"), board("d4", "Time?", "2026-10-06T10:03:00Z"),
    row("v1", b, "2026-10-06T10:05:00Z"), row("v2", a, "2026-10-06T10:06:00Z"), row("v3", a, "2026-10-06T10:07:00Z"), row("v4", b, "2026-10-06T10:08:00Z"), row("v5", a, "2026-10-06T10:09:00Z")];
  const decision = (title: string) => ({ state: "open", payload: { type: "decision", title, options: ["One", "Two"] } });
  const voteFor = (boardId: string, choice: number) => ({ state: "open", payload: { type: "vote", boardId, choice } });
  const opened = {
    d1: decision("Who books?"), d2: decision("Which plan?"), d3: decision("Lunch?"), d4: decision("Time?"),
    v1: voteFor("d1", 1),            // Jerry (b) voted on d1: my turn
    v2: voteFor("d2", 0),            // I voted on d2: waiting on Jerry
    v3: voteFor("d3", 1), v4: voteFor("d3", 1),   // both voted the same on d3: decided
    v5: voteFor("d4", 0)             // I voted on d4 ...
  } as never;
  const messages = buildMessages({ live: true, rows: rowsD, opened, pending: [], selfId: a });
  const { open, decided } = buildDecisions(messages, a, b, "Jerry");
  assert.deepEqual(open.map((d) => [d.title, d.status]), [["Who books?", "Jerry voted, your turn"], ["Which plan?", "Waiting on Jerry"], ["Time?", "Waiting on Jerry"]]);
  assert.deepEqual(decided.map((d) => [d.title, d.status, d.winner]), [["Lunch?", "Decided", 1]]);
  assert.equal(open.find((d) => d.title === "Who books?")!.theirs, 1);
  assert.equal(open.find((d) => d.title === "Which plan?")!.mine, 0);
});

test("decisions: when both voted differently it is decided with no winner; a decision nobody voted on says so", () => {
  const rowsD = [row("d1", a, "2026-10-06T10:00:00Z"), row("d2", a, "2026-10-06T10:01:00Z"), row("v1", a, "2026-10-06T10:02:00Z"), row("v2", b, "2026-10-06T10:03:00Z")];
  const opened = {
    d1: { state: "open", payload: { type: "decision", title: "Split", options: ["A", "B"] } },
    d2: { state: "open", payload: { type: "decision", title: "Fresh", options: ["A", "B"] } },
    v1: { state: "open", payload: { type: "vote", boardId: "d1", choice: 0 } },
    v2: { state: "open", payload: { type: "vote", boardId: "d1", choice: 1 } }
  } as never;
  const { open, decided } = buildDecisions(buildMessages({ live: true, rows: rowsD, opened, pending: [], selfId: a }), a, b, "Jerry");
  assert.equal(decided[0]!.status, "Decided, votes differ");
  assert.equal(decided[0]!.winner, null);
  assert.equal(open[0]!.status, "No votes yet");
});

test("decisions: while sealed there are none to show", () => {
  const messages = buildMessages({ live: false, rows, opened: opened as never, pending: [], selfId: a });
  assert.deepEqual(buildDecisions(messages, a, b, "Jerry"), { open: [], decided: [] });
});

test("mute goes to the server for this conversation", async () => {
  const calls = stubFetch(() => ({ muted: true }));
  await svc().setMuted(conv, true);
  assert.match(calls[0]!.url, new RegExp("/v1/chats/" + conv + "/mute$"));
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { muted: true });
  assert.equal(calls[0]!.init!.method, "POST");
});

// ---- the design-preview sample conversation ----------------------------------------------------------------

test("preview sample: unreadable and decisions are in the data; a message with 'fail' fails once and the retry goes through", async () => {
  const { createPreviewConversation, PREVIEW_SELF } = await import("../clients/mobile/services/conversation-preview.ts");
  const { service, gate } = createPreviewConversation();
  assert.deepEqual(await gate.evaluate(), { mode: "LIVE" });
  const { rows: all } = await service.loadHistory("preview");
  const opened = await service.decryptServerRows("preview", all);
  assert.equal(opened.filter((r) => !r.ok).length, 1);
  const messages = buildMessages({ live: true, rows: all, opened: Object.fromEntries(opened.map((r) => [r.id, r.ok ? { state: "open", payload: JSON.parse(r.text) } : { state: "unreadable" }])) as never, pending: [], selfId: PREVIEW_SELF });
  const { open, decided } = buildDecisions(messages, PREVIEW_SELF, "preview-jerry", "Jerry");
  assert.deepEqual([open.length, decided.length], [2, 3]);
  const text = { type: "text", text: "this will fail", lane: "General" } as const;
  await assert.rejects(service.send("preview", text, "id-1"), /PREVIEW_FAILURE/);
  assert.equal((await service.send("preview", text, "id-1")).senderId, PREVIEW_SELF);
});

// ---- settings: pin and disappearing messages --------------------------------------------------------------

test("disappearing choices are exactly the values the server accepts, with plain labels", async () => {
  const { DISAPPEAR_CHOICES, disappearLabel } = await import("../clients/mobile/services/conversation-engine.ts");
  assert.deepEqual(DISAPPEAR_CHOICES.map((c) => c.seconds), [null, 86_400, 604_800, 2_419_200]);
  assert.deepEqual(DISAPPEAR_CHOICES.map((c) => c.label), ["Off", "1 day", "1 week", "4 weeks"]);
  assert.equal(disappearLabel(604_800), "1 week");
  assert.equal(disappearLabel(null), "off");
  assert.equal(disappearLabel(12345), "off");
});

test("pin, disappearing and settings go to this conversation's own routes", async () => {
  const calls = stubFetch((url) => (url.endsWith("/settings") ? { muted: true, pinned: false, disappearAfterSeconds: 86_400 } : {}));
  const s = svc();
  assert.deepEqual(await s.settings(conv), { muted: true, pinned: false, disappearAfterSeconds: 86_400 });
  await s.setPinned(conv, true);
  await s.setDisappearing(conv, 604_800);
  await s.setDisappearing(conv, null);
  const post = (i: number) => ({ url: calls[i]!.url, body: JSON.parse(String(calls[i]!.init!.body)) });
  assert.match(calls[0]!.url, new RegExp("/v1/chats/" + conv + "/settings$"));
  assert.match(post(1).url, /\/pin$/); assert.deepEqual(post(1).body, { pinned: true });
  assert.match(post(2).url, /\/disappearing$/); assert.deepEqual(post(2).body, { seconds: 604_800 });
  assert.deepEqual(post(3).body, { seconds: null });
});

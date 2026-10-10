// Run: npx tsx --test __tests__/logic.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeContent, encodeContent } from "../content/codec";
import { ContentMessage, PollContent } from "../content/types";
import { nextVote, tallyPoll } from "../features/polls/pollModel";
import { joinState, rsvpTally } from "../features/schedule/scheduleModel";
import { Board, Element, Op } from "../whiteboard/model";
import { fitCamera, hitTest, screenToWorld, simplify, worldToScreen, zoomAt } from "../whiteboard/geometry";
import { initialCrop, moveCrop, resizeCrop, toImagePixels } from "../documents/cropMath";

// --- codec --------------------------------------------------------------------

test("codec round-trips every content type", () => {
  const samples = [
    { type: "text", text: "hi" },
    { type: "location", latitude: 39.2, longitude: -76.8, label: "North gate" },
    { type: "contact", name: "Ama Boateng", phones: [{ number: "+1 555 0100" }] },
    { type: "poll", pollId: "p1", question: "Lunch?", options: [{ id: "a", label: "Yes" }, { id: "b", label: "No" }], multi: false, hideVoters: false },
    { type: "poll_vote", pollId: "p1", optionIds: ["a"] },
    { type: "event", eventId: "e1", title: "Walkthrough", startsAt: "2026-10-15T14:00:00Z", endsAt: "2026-10-15T15:30:00Z" },
    { type: "event_rsvp", eventId: "e1", response: "going" },
    { type: "meeting", meetingId: "m1", title: "Review", startsAt: "2026-10-16T18:00:00Z", durationMin: 30 },
    { type: "live_session", sessionId: "s1", state: "started", screenShare: true },
    { type: "rtc_signal", sessionId: "s1", signal: { kind: "hangup" } },
    {
      type: "file", fileKind: "document", name: "plan.pdf", mime: "application/pdf", size: 10, blobId: "00000000-0000-4000-8000-000000000001",
      key: "A".repeat(43) + "=", nonce: "A".repeat(32), sha256: "a".repeat(64),
    },
  ] as const;
  for (const s of samples) assert.deepEqual(decodeContent(encodeContent(s as never)), s, s.type);
});

test("codec rejects malformed or hostile content", () => {
  const bad = [
    { type: "location", latitude: 200, longitude: 0 },
    { type: "poll", pollId: "p", question: "q", options: [{ id: "a", label: "x" }], multi: false, hideVoters: false }, // 1 option
    { type: "poll", pollId: "p", question: "q", options: [{ id: "a", label: "x" }, { id: "a", label: "y" }], multi: false, hideVoters: false }, // dup id
    { type: "event", eventId: "e", title: "t", startsAt: "2026-10-15T15:00:00Z", endsAt: "2026-10-15T14:00:00Z" }, // ends before start
    { type: "file", fileKind: "document", name: "x", mime: "x", size: 1, blobId: "b", key: "k", nonce: "n", sha256: "nothex" },
    { type: "meeting", meetingId: "m", title: "t", startsAt: "2026-10-16T18:00:00Z", durationMin: 0 },
    { type: "rtc_signal", sessionId: "s", signal: { kind: "description", sdp: { type: "pranswer", sdp: "x" } } },
    { type: "unknown_thing" },
  ];
  for (const b of bad) assert.equal(decodeContent(JSON.stringify({ v: 1, c: b })), null, JSON.stringify(b));
  assert.equal(decodeContent(JSON.stringify({ v: 99, c: { type: "text", text: "from the future" } })), null);
});

test("plain strings from older app versions decode as text", () => {
  assert.deepEqual(decodeContent("hello there"), { type: "text", text: "hello there" });
});

// --- polls ---------------------------------------------------------------------

const poll: PollContent = {
  type: "poll", pollId: "p1", question: "Lunch?", multi: false, hideVoters: false,
  options: [{ id: "a", label: "Yes" }, { id: "b", label: "Quick" }, { id: "c", label: "No" }],
  closesAt: "2026-10-09T12:00:00Z",
};
const vote = (id: string, sender: string, at: string, optionIds: string[], pollId = "p1"): ContentMessage => ({
  id, senderId: sender, sentAt: at, outgoing: sender === "me", content: { type: "poll_vote", pollId, optionIds },
});

test("poll: latest vote per person counts, late and foreign votes ignored", () => {
  const msgs = [
    vote("1", "me", "2026-10-09T10:00:00Z", ["a"]),
    vote("2", "jerry", "2026-10-09T10:01:00Z", ["b"]),
    vote("3", "me", "2026-10-09T10:02:00Z", ["c"]), // changed mind
    vote("4", "jerry", "2026-10-09T13:00:00Z", ["a"]), // after close
    vote("5", "jerry", "2026-10-09T10:03:00Z", ["zzz"]), // unknown option -> treated as retract? no: newest valid wins below
    vote("6", "eve", "2026-10-09T10:00:00Z", ["a"], "other-poll"),
  ];
  const t = tallyPoll(poll, msgs, "me", Date.parse("2026-10-09T11:00:00Z"));
  assert.deepEqual(t.myVote, ["c"]);
  // Jerry's latest pre-close vote had only an unknown option, so it counts as no vote.
  assert.equal(t.counts.b, 0);
  assert.equal(t.counts.c, 1);
  assert.equal(t.totalVoters, 1);
  assert.equal(t.closed, false);
  assert.equal(tallyPoll(poll, msgs, "me", Date.parse("2026-10-09T12:30:00Z")).closed, true);
});

test("poll: single choice keeps one answer; multi toggles", () => {
  const t = tallyPoll(poll, [vote("1", "jerry", "2026-10-09T10:00:00Z", ["a", "b"])], "me", 0);
  assert.equal(t.counts.a + t.counts.b, 1);
  assert.deepEqual(nextVote(poll, ["a"], "a"), []);
  assert.deepEqual(nextVote(poll, ["a"], "b"), ["b"]);
  const multi = { ...poll, multi: true };
  assert.deepEqual(nextVote(multi, ["a"], "b"), ["a", "b"]);
  assert.deepEqual(nextVote(multi, ["a", "b"], "a"), ["b"]);
});

test("poll: hidden voters are not listed", () => {
  const t = tallyPoll({ ...poll, hideVoters: true }, [vote("1", "jerry", "2026-10-09T10:00:00Z", ["a"])], "me", 0);
  assert.equal(t.counts.a, 1);
  assert.deepEqual(t.voters.a, []);
});

// --- schedule ------------------------------------------------------------------

test("meeting join window opens 10 min early and closes 15 min after the end", () => {
  const m = { type: "meeting" as const, meetingId: "m", title: "t", startsAt: "2026-10-09T14:00:00Z", durationMin: 30 };
  assert.deepEqual(joinState(m, Date.parse("2026-10-09T13:30:00Z")), { state: "upcoming", opensInMin: 20 });
  assert.deepEqual(joinState(m, Date.parse("2026-10-09T13:50:00Z")), { state: "open" });
  assert.deepEqual(joinState(m, Date.parse("2026-10-09T14:45:00Z")), { state: "open" });
  assert.deepEqual(joinState(m, Date.parse("2026-10-09T14:46:00Z")), { state: "ended" });
});

test("rsvp: latest response per person", () => {
  const ev = { type: "event" as const, eventId: "e", title: "t", startsAt: "2026-10-15T14:00:00Z", endsAt: "2026-10-15T15:00:00Z" };
  const r = (id: string, s: string, at: string, response: "going" | "maybe" | "declined"): ContentMessage => ({ id, senderId: s, sentAt: at, outgoing: false, content: { type: "event_rsvp", eventId: "e", response } });
  const t = rsvpTally(ev, [r("1", "jerry", "2026-10-09T10:00:00Z", "maybe"), r("2", "jerry", "2026-10-09T11:00:00Z", "going"), r("3", "me", "2026-10-09T10:30:00Z", "declined")]);
  assert.equal(t.get("jerry"), "going");
  assert.equal(t.get("me"), "declined");
});

// --- whiteboard: convergence ---------------------------------------------------

function stroke(id: string): Element {
  return { id, kind: "stroke", points: [[0, 0], [10, 10]], color: "#1C2833", width: 2 } as never;
}

test("whiteboard: two boards converge regardless of delivery order", () => {
  const a = new Board("alice");
  const b = new Board("bob");
  const opsA: Op[] = [...a.add(stroke("s1") as never), ...a.add({ id: "n1", kind: "sticky", x: 0, y: 0, w: 100, h: 100, text: "", color: "#FFE48A" } as never)];
  const opsB: Op[] = b.add(stroke("s2") as never);
  // Both edit the sticky "at the same time": alice writes text, bob receives first then moves it.
  b.receive(opsA, "alice");
  const moveB = b.update([{ id: "n1", patch: { x: 50 } }]);
  const textA = a.update([{ id: "n1", patch: { text: "Agenda" } }]);
  // Deliver in opposite orders.
  a.receive([...moveB, ...opsB].reverse(), "bob");
  b.receive(textA, "alice");
  const view = (x: Board) => JSON.stringify(x.elements().map((e) => [e.id, (e as { x?: number }).x, (e as { text?: string }).text]));
  assert.equal(view(a), view(b));
  assert.equal(a.elements().length, 3);
});

test("whiteboard: delete that arrives before the element still wins", () => {
  const a = new Board("alice");
  const b = new Board("bob");
  const add = a.add(stroke("s1") as never);
  const del = a.remove(["s1"]);
  b.receive(del, "alice");
  b.receive(add, "alice");
  assert.equal(b.elements().length, 0);
});

test("whiteboard: undo/redo only affect your own actions and sync", () => {
  const a = new Board("alice");
  const b = new Board("bob");
  b.receive(a.add(stroke("s1") as never), "alice");
  a.receive(b.add(stroke("s2") as never), "bob");
  b.receive(a.undo(), "alice");
  assert.deepEqual(a.elements().map((e) => e.id), ["s2"]);
  assert.deepEqual(b.elements().map((e) => e.id), ["s2"]);
  b.receive(a.redo(), "alice");
  assert.equal(b.elements().length, 2);
});

test("whiteboard: peers can't impersonate, and locks are enforced", () => {
  const a = new Board("alice");
  const b = new Board("bob");
  const evil = a.add(stroke("s1") as never);
  // Bob relays alice's op as if it came from him: rejected (author/clock mismatch).
  const c = new Board("carol");
  assert.equal(c.receive(evil, "bob"), 0);
  // Lock: only alice may draw.
  const allowOnlyAlice = (author: string) => author === "alice";
  assert.equal(a.receive(b.add(stroke("s2") as never), "bob", allowOnlyAlice), 0);
});

test("whiteboard: invalid ops are dropped", () => {
  const a = new Board("alice");
  const n = a.receive(
    [
      { op: "upsert", el: { id: "x", author: "bob", clock: { c: 1, a: "bob" }, z: 1, kind: "stroke", points: [[1e9, 0]], color: "#000000", width: 2 } },
      { op: "upsert", el: { id: "y", author: "bob", clock: { c: 1, a: "bob" }, z: 1, kind: "text", x: 0, y: 0, text: "hi", color: "red", size: 12 } },
      { op: "nope" },
      null,
    ],
    "bob"
  );
  assert.equal(n, 0);
});

// --- geometry ------------------------------------------------------------------

test("zoomAt keeps the focal point fixed", () => {
  const cam = { x: 100, y: 50, zoom: 1 };
  const before = screenToWorld(cam, 200, 300);
  const after = zoomAt(cam, 2.5, 200, 300);
  const p = worldToScreen(after, before[0], before[1]);
  assert.ok(Math.abs(p[0] - 200) < 1e-9 && Math.abs(p[1] - 300) < 1e-9);
  assert.equal(zoomAt(cam, 1000, 0, 0).zoom, 8); // clamped
});

test("fitCamera shows all elements", () => {
  const els = [{ ...stroke("a"), points: [[-500, -200], [500, 300]] }] as Element[];
  const cam = fitCamera(els, 400, 800, 40);
  const tl = worldToScreen(cam, -500, -200);
  const br = worldToScreen(cam, 500, 300);
  assert.ok(tl[0] >= 39 && br[0] <= 361 && tl[1] >= 0 && br[1] <= 800);
});

test("hit testing and simplification", () => {
  const s = { ...stroke("a"), points: [[0, 0], [100, 0]], width: 4 } as Element;
  assert.ok(hitTest(s, 50, 3, 1));
  assert.ok(!hitTest(s, 50, 10, 1));
  const line = Array.from({ length: 100 }, (_, i) => [i, 0] as [number, number]);
  assert.equal(simplify(line, 0.5).length, 2);
});

// --- crop ----------------------------------------------------------------------

test("crop stays inside the image and maps to pixels", () => {
  const area = { x: 10, y: 20, width: 300, height: 200 };
  const sq = initialCrop(area, 1);
  assert.equal(Math.round(sq.width), Math.round(sq.height));
  const moved = moveCrop(sq, 1000, 1000, area);
  assert.equal(moved.x + moved.width, area.x + area.width);
  const grown = resizeCrop(sq, 1000, 0, area, 16 / 9);
  assert.ok(grown.x + grown.width <= area.x + area.width + 1e-9 && grown.y + grown.height <= area.y + area.height + 1e-9);
  assert.ok(Math.abs(grown.width / grown.height - 16 / 9) < 1e-9);
  const px = toImagePixels({ x: 10, y: 20, width: 300, height: 200 }, area, { width: 3000, height: 2000 });
  assert.deepEqual(px, { originX: 0, originY: 0, width: 3000, height: 2000 });
});

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openJson, sealJson, workspaceKey } from "./workspace-crypto.ts";
import {
  atTime, canSeeAudit, checklistProgress, dayKey, emptyEvent, emptyNote, eventColor, eventLine, eventProblem, groupByDay, monthWindow, noteHeading,
  noteKind, noteProblem, notePreview, orderNotes, parseTags, pointsToPath, policyValueText, reminderAt, roleLabel, searchNotes, shiftAnchor, strokeChars,
  timeAgo, upcoming, viewDays, viewTitle, viewWindow, type CalendarEvent, type Note
} from "./workspace-model.ts";
import { clampOffsets, DEFAULT_POSITION, isDrag, parsePosition, serializePosition, snapPosition, toOffsets } from "./fab-position.ts";

const random = (n: number) => new Uint8Array(randomBytes(n));
const vaultKey = random(32);
const key = workspaceKey(vaultKey);

// --- encryption ---
{
  const note = { title: "Roadmap", body: "Bring the draft", tags: ["plan"] };
  const boxed = sealJson(key, "note", note, random);
  assert.deepEqual(openJson(key, "note", boxed), note);
  assert.equal(Buffer.from(boxed).includes(Buffer.from("Roadmap")), false);
  assert.equal(Buffer.from(boxed).includes(Buffer.from("draft")), false);
  assert.notDeepEqual(sealJson(key, "note", note, random), boxed);
  assert.throws(() => openJson(workspaceKey(random(32)), "note", boxed), /can't be opened/);
  assert.throws(() => openJson(key, "event", boxed), /can't be opened/);
  const tampered = Uint8Array.from(boxed); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => openJson(key, "note", tampered), /can't be opened/);
  assert.throws(() => openJson(key, "note", new Uint8Array(10)), /damaged/);
  assert.notDeepEqual(key, vaultKey);
  assert.deepEqual(workspaceKey(vaultKey), key);
  assert.throws(() => workspaceKey(new Uint8Array(16)), /not valid/);
  assert.throws(() => sealJson(key, "note", note, () => new Uint8Array(8)), /randomness/);
}

// --- notes ---
const note = (over: Partial<Note>): Note => ({ ...emptyNote(), id: "n", createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z", ...over });
{
  assert.equal(noteProblem(emptyNote()), "Write a title or some text first.");
  assert.equal(noteProblem({ ...emptyNote(), body: "hi" }), null);
  assert.match(noteProblem({ ...emptyNote(), title: "x".repeat(201) })!, /200/);
  assert.match(noteProblem({ ...emptyNote(), body: "x".repeat(100_001) })!, /100,000/);
  assert.match(noteProblem({ ...emptyNote(), body: "hi", tags: Array(21).fill("a") })!, /tags/);
  assert.equal(noteProblem({ ...emptyNote(), attachments: [{ vaultId: "v", name: "a.pdf", size: 1 }] }), null);
  assert.deepEqual(parseTags("ideas, work  #plan Ideas"), ["ideas", "work", "plan"]);
  assert.deepEqual(parseTags("  ,, "), []);
  assert.equal(parseTags(Array.from({ length: 30 }, (_, i) => "t" + i).join(" ")).length, 20);
  assert.equal(noteKind({}), "NOTE");

  const ordered = orderNotes([note({ id: "old", updatedAt: "2026-06-01T00:00:00Z" }), note({ id: "pin", pinned: true, updatedAt: "2026-05-01T00:00:00Z" }), note({ id: "new", updatedAt: "2026-06-05T00:00:00Z" })]);
  assert.deepEqual(ordered.map((n) => n.id), ["pin", "new", "old"]);

  const set = [note({ id: "a", title: "Trip plan", body: "flights" }), note({ id: "b", title: "Secret", body: "password hunter2", locked: true, pinned: true }), note({ id: "c", title: "Work", body: "x", category: "Work", tags: ["q3"] })];
  assert.deepEqual(searchNotes(set, "flights", null).map((n) => n.id), ["a"]);
  assert.deepEqual(searchNotes(set, "hunter2", null), []);
  assert.deepEqual(searchNotes(set, "secret", null).map((n) => n.id), ["b"]);
  assert.deepEqual(searchNotes(set, "", "Work").map((n) => n.id), ["c"]);
  assert.deepEqual(searchNotes(set, "Q3", null).map((n) => n.id), ["c"]);
  assert.deepEqual(searchNotes(set, "", null, "pinned").map((n) => n.id), ["b"]);
  assert.deepEqual(searchNotes(set, "", null, "locked").map((n) => n.id), ["b"]);
  assert.equal(notePreview({ body: "secret text", locked: true }), "Locked. Unlock to read.");
  assert.equal(notePreview({ body: "a\n\n b   c", locked: false }), "a b c");
  assert.equal(noteHeading({ title: "", body: "first line\nsecond", locked: false }), "first line");
  assert.equal(noteHeading({ title: "", body: "secret", locked: true }), "Locked note");
  assert.equal(noteHeading({ title: "", body: "", locked: false }), "Untitled");
}

// --- checklists, drawings, attachments ---
{
  const list = { ...emptyNote("CHECKLIST"), items: [{ id: "1", text: "Milk", done: true }, { id: "2", text: "Eggs", done: false }, { id: "3", text: "  ", done: false }] };
  assert.deepEqual(checklistProgress(list.items), { done: 1, total: 2 }); // blank rows aren't items
  assert.equal(notePreview({ ...list, locked: false }), "1 of 2 done");
  assert.equal(noteProblem(list), null);
  assert.equal(noteProblem(emptyNote("CHECKLIST")), "Add a title or at least one item.");
  assert.equal(noteProblem({ ...emptyNote("CHECKLIST"), title: "Groceries" }), null);
  assert.match(noteProblem({ ...list, items: Array.from({ length: 201 }, (_, i) => ({ id: String(i), text: "x", done: false })) })!, /200 items/);
  assert.equal(noteHeading({ ...list, locked: false }), "Milk");
  assert.deepEqual(searchNotes([note({ ...list, id: "l" })], "eggs", null).map((n) => n.id), ["l"]);
  assert.deepEqual(searchNotes([note({ ...list, id: "l", locked: true })], "eggs", null), []);

  const drawing = { ...emptyNote("DRAWING"), strokes: [{ color: "#fff", width: 3, d: "M0 0L5 5" }] };
  assert.equal(noteProblem(drawing), null);
  assert.equal(noteProblem(emptyNote("DRAWING")), "Draw something or add a title first.");
  assert.match(noteProblem({ ...drawing, strokes: [{ color: "#fff", width: 3, d: "M".padEnd(150_001, "L") }] })!, /too detailed/);
  assert.equal(notePreview({ ...drawing, locked: false }), "Drawing · 1 stroke");
  assert.equal(noteHeading({ ...drawing, locked: false }), "Drawing");
  assert.ok(strokeChars(drawing.strokes) > 0);

  assert.equal(pointsToPath([{ x: 1.04, y: 2.06 }]), "M1 2.1l0.1 0"); // a tap is a dot
  assert.equal(pointsToPath([{ x: 0, y: 0 }, { x: 0.4, y: 0.4 }, { x: 10, y: 10 }]), "M0 0L10 10"); // near points are dropped
  assert.equal(pointsToPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10.2, y: 10.2 }]), "M0 0L10 10L10.2 10.2"); // the end point is kept
  assert.equal(pointsToPath([]), ""); // no points, no path
}

// --- time ago ---
{
  const now = Date.parse("2026-06-10T12:00:00Z");
  assert.equal(timeAgo("2026-06-10T11:59:40Z", now), "just now");
  assert.equal(timeAgo("2026-06-10T11:15:00Z", now), "45m ago");
  assert.equal(timeAgo("2026-06-10T10:00:00Z", now), "2h ago");
  assert.equal(timeAgo("2026-06-09T12:00:00Z", now), "1d ago");
  assert.equal(timeAgo("2026-06-10T12:00:30Z", now), "just now"); // never negative
  assert.match(timeAgo("2026-01-02T12:00:00Z", now), /Jan/);
}

// --- calendar ---
{
  const base = { title: "Standup", location: "", meetingUrl: "", timeZone: "UTC", description: "" };
  const s = new Date(2026, 5, 10, 13, 0), e = new Date(2026, 5, 10, 13, 30);
  assert.equal(eventProblem(base, s, e), null);
  assert.equal(eventProblem({ ...base, title: " " }, s, e), "Give the event a title.");
  assert.equal(eventProblem(base, s, s), "The event has to end after it starts.");
  assert.equal(eventProblem(base, e, s), "The event has to end after it starts.");
  assert.equal(eventProblem(base, null, e), "Choose a start and an end time.");
  assert.equal(eventProblem(base, new Date("nope"), e), "Choose a start and an end time.");
  assert.match(eventProblem({ ...base, meetingUrl: "http://insecure.example" }, s, e)!, /https/);
  assert.match(eventProblem({ ...base, meetingUrl: "javascript:alert(1)" }, s, e)!, /https/);
  assert.equal(eventProblem({ ...base, meetingUrl: "https://meet.example/abc" }, s, e), null);

  const w = monthWindow(2026, 5);
  assert.equal(new Date(w.from).getMonth(), 5);
  assert.equal(new Date(w.to).getMonth(), 6);
  assert.deepEqual(monthWindow(2026, 11).to, new Date(2027, 0, 1).toISOString());

  const ev = (id: string, d: Date, over: Partial<CalendarEvent> = {}): CalendarEvent => ({ ...base, id, startsAt: d.toISOString(), endsAt: new Date(+d + 3_600_000).toISOString(), ...over });
  const groups = groupByDay([ev("late", new Date(2026, 5, 11, 9)), ev("b", new Date(2026, 5, 10, 15)), ev("a", new Date(2026, 5, 10, 8))]);
  assert.deepEqual(groups.map((g) => g.day), ["2026-06-10", "2026-06-11"]);
  assert.deepEqual(groups[0]!.events.map((x) => x.id), ["a", "b"]);
  assert.equal(dayKey(new Date(2026, 0, 5)), "2026-01-05");
  const t = atTime(new Date(2026, 5, 10, 22, 45), 7, 5);
  assert.equal(t.getHours() * 60 + t.getMinutes(), 425);
  assert.equal(t.getDate(), 10);

  // views: October 2026 starts on a Thursday and has 31 days: 5 weeks, Sun Sep 27 to Sat Oct 31
  const oct = viewDays("month", new Date(2026, 9, 14));
  assert.equal(oct.length, 35);
  assert.equal(dayKey(oct[0]!), "2026-09-27");
  assert.equal(dayKey(oct[34]!), "2026-10-31");
  assert.equal(oct.every((d) => d.getDay() === (oct.indexOf(d) % 7)), true);
  assert.equal(viewDays("month", new Date(2026, 1, 10)).length, 28); // Feb 2026 is exactly four weeks
  assert.equal(viewDays("month", new Date(2026, 2, 10)).length, 35); // March 2026 starts on a Sunday
  assert.equal(viewDays("month", new Date(2026, 7, 10)).length, 42); // August 2026 needs six rows
  const week = viewDays("week", new Date(2026, 9, 14));
  assert.deepEqual([dayKey(week[0]!), dayKey(week[6]!)], ["2026-10-11", "2026-10-17"]);
  const win = viewWindow("week", new Date(2026, 9, 14));
  assert.equal(win.from, new Date(2026, 9, 11).toISOString());
  assert.equal(win.to, new Date(2026, 9, 18).toISOString());
  assert.equal(dayKey(shiftAnchor("month", new Date(2026, 0, 31), 1)), "2026-02-01"); // no overflow past February
  assert.equal(dayKey(shiftAnchor("month", new Date(2026, 0, 15), -1)), "2025-12-01");
  assert.equal(dayKey(shiftAnchor("week", new Date(2026, 9, 14), 1)), "2026-10-21");
  assert.equal(viewTitle("week", new Date(2026, 9, 14)).includes("–"), true);
  assert.match(viewTitle("month", new Date(2026, 9, 14)), /2026/);

  const now = new Date(2026, 5, 10, 12).getTime();
  assert.deepEqual(upcoming([ev("past", new Date(2026, 5, 10, 8)), ev("now", new Date(2026, 5, 10, 11, 30)), ev("later", new Date(2026, 5, 10, 15)), ev("soon", new Date(2026, 5, 10, 13))], now).map((x) => x.id), ["now", "soon", "later"]);

  assert.deepEqual(eventLine({ location: "Room 3B", meetingUrl: "" }), { kind: "place", text: "Room 3B" });
  assert.deepEqual(eventLine({ location: "Room 3B", meetingUrl: "https://meet.example/x" }), { kind: "video", text: "Video Meeting" });
  assert.deepEqual(eventLine({ location: "", meetingUrl: "http://nope" }), { kind: "none", text: "" });
  assert.equal(eventColor({}), "#1677FF");
  assert.equal(eventColor({ color: "orange" }), "#F5A524");
  assert.equal(emptyEvent().color, "blue");

  assert.equal(reminderAt(new Date(now + 10 * 60_000).toISOString(), now), null); // too soon to remind
  assert.equal(reminderAt(new Date(now - 60_000).toISOString(), now), null);
  assert.equal(+reminderAt(new Date(now + 60 * 60_000).toISOString(), now)!, now + 45 * 60_000);
  assert.equal(reminderAt("garbage", now), null);
}

// --- enterprise ---
{
  for (const r of ["OWNER", "ADMIN", "SECURITY_ADMIN", "COMPLIANCE_ADMIN"]) assert.equal(canSeeAudit(r), true);
  assert.equal(canSeeAudit("MEMBER"), false);
  assert.equal(canSeeAudit("owner"), false);
  assert.equal(roleLabel("SECURITY_ADMIN"), "Security Admin");
  assert.equal(policyValueText(true), "On");
  assert.equal(policyValueText({ days: 90 }), '{"days":90}');
  assert.equal(policyValueText(null), "Not set");
  assert.equal(policyValueText({ a: "x".repeat(500) }).length, 160);
}

// --- movable button ---
{
  const bounds = { w: 400, h: 800 }, fab = { w: 120, h: 48 }, margin = 16, inset = 0;
  assert.deepEqual(toOffsets(DEFAULT_POSITION, bounds, fab, margin), { x: 264, y: 736 }); // bottom right
  assert.deepEqual(toOffsets({ side: "left", y: 0 }, bounds, fab, margin), { x: 16, y: 16 }); // top left
  assert.equal(toOffsets({ side: "right", y: 0.5 }, bounds, fab, margin).y, 376);
  assert.equal(toOffsets({ side: "right", y: 1 }, bounds, fab, margin, 40).y, 696); // keeps clear of a bottom inset
  // dragged past the edges stays on screen
  assert.deepEqual(clampOffsets({ x: -50, y: 900 }, bounds, fab, margin), { x: 16, y: 736 });
  assert.deepEqual(clampOffsets({ x: 500, y: -5 }, bounds, fab, margin), { x: 264, y: 16 });
  // released on the left half snaps left, the right half snaps right, keeping height
  assert.deepEqual(snapPosition({ x: 40, y: 376 }, bounds, fab, margin), { side: "left", y: 0.5 });
  assert.equal(snapPosition({ x: 300, y: 376 }, bounds, fab, margin).side, "right");
  assert.equal(snapPosition({ x: 139, y: 100 }, bounds, fab, margin).side, "left"); // centre just left of the midpoint
  assert.equal(snapPosition({ x: 140, y: 100 }, bounds, fab, margin).side, "right"); // exactly on the midpoint goes right
  assert.equal(snapPosition({ x: 0, y: 5000 }, bounds, fab, margin).y, 1);
  // a screen too small for the button doesn't produce NaN
  assert.deepEqual(toOffsets({ side: "right", y: 0.5 }, { w: 100, h: 40 }, fab, margin), { x: 16, y: 16 });
  assert.equal(Number.isNaN(snapPosition({ x: 0, y: 0 }, { w: 100, h: 40 }, fab, margin).y), false);
  // saved positions survive a round trip and reject junk
  assert.deepEqual(parsePosition(serializePosition({ side: "left", y: 0.25 })), { side: "left", y: 0.25 });
  assert.equal(parsePosition(null), null);
  assert.equal(parsePosition("not json"), null);
  assert.equal(parsePosition('{"side":"top","y":0.5}'), null);
  assert.equal(parsePosition('{"side":"left","y":"x"}'), null);
  assert.equal(parsePosition('{"side":"right","y":7}')!.y, 1); // out of range is pulled back in
  // tap versus drag
  assert.equal(isDrag(2, 3), false);
  assert.equal(isDrag(10, 0), true);
  assert.equal(inset, 0);
}

console.log("workspace: ok");

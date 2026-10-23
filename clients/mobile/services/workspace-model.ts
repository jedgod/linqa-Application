/**
 * Pure rules for Notes and Calendar: what a note or event contains once decrypted, how it's validated, ordered, searched and
 * grouped. Nothing here touches the network, storage or the screen, so every rule can be tested directly.
 */
export const NOTE_CATEGORIES = ["Personal", "Work", "Meeting", "Ideas", "Lists"] as const;
export const MAX_NOTE_BODY = 100_000;
export const MAX_NOTE_TITLE = 200;
export const MAX_TAGS = 20;
export const MAX_TAG = 40;
export const MAX_CHECKLIST_ITEMS = 200;
export const MAX_ITEM_TEXT = 300;
/** A drawing is stored as path text inside the sealed note, so it is capped well under the server's size limit. */
export const MAX_DRAWING_CHARS = 150_000;
export const MAX_ATTACHMENTS = 10;

export type NoteKind = "NOTE" | "CHECKLIST" | "DRAWING";
export type ChecklistItem = { id: string; text: string; done: boolean };
export type Stroke = { color: string; width: number; d: string };
/** A file saved (encrypted) in LinqaVault and linked from the note. The note holds the link, not the file. */
export type Attachment = { vaultId: string; name: string; size: number };

export type NoteContent = {
  /** Older notes have no kind and are plain notes. */
  kind?: NoteKind;
  title: string; body: string; category: string; tags: string[]; pinned: boolean; locked: boolean;
  items?: ChecklistItem[]; strokes?: Stroke[]; attachments?: Attachment[];
};
export type Note = NoteContent & { id: string; createdAt: string; updatedAt: string };

export const emptyNote = (kind: NoteKind = "NOTE"): NoteContent => ({
  kind, title: "", body: "", category: "Personal", tags: [], pinned: false, locked: false,
  ...(kind === "CHECKLIST" ? { items: [] } : {}), ...(kind === "DRAWING" ? { strokes: [] } : {})
});
export const noteKind = (n: Pick<NoteContent, "kind">): NoteKind => n.kind ?? "NOTE";

export const checklistProgress = (items: ChecklistItem[] | undefined) => {
  const all = (items ?? []).filter((i) => i.text.trim());
  return { done: all.filter((i) => i.done).length, total: all.length };
};
export const strokeChars = (strokes: Stroke[] | undefined) => (strokes ?? []).reduce((n, s) => n + s.d.length + 24, 0);

/** The first problem with a note, in words a person can act on, or null if it can be saved. */
export function noteProblem(n: NoteContent): string | null {
  const kind = noteKind(n);
  if (n.title.length > MAX_NOTE_TITLE) return `A title can be up to ${MAX_NOTE_TITLE} characters.`;
  if (n.tags.length > MAX_TAGS || n.tags.some((t) => !t || t.length > MAX_TAG)) return `Use up to ${MAX_TAGS} tags of at most ${MAX_TAG} characters.`;
  if (kind === "CHECKLIST") {
    const items = n.items ?? [];
    if (!n.title.trim() && !items.some((i) => i.text.trim())) return "Add a title or at least one item.";
    if (items.length > MAX_CHECKLIST_ITEMS) return `A checklist can have up to ${MAX_CHECKLIST_ITEMS} items.`;
    if (items.some((i) => i.text.length > MAX_ITEM_TEXT)) return `An item can be up to ${MAX_ITEM_TEXT} characters.`;
  } else if (kind === "DRAWING") {
    if (!n.title.trim() && !(n.strokes ?? []).length) return "Draw something or add a title first.";
    if (strokeChars(n.strokes) > MAX_DRAWING_CHARS) return "This drawing is too detailed to save. Undo some strokes or clear it.";
  } else {
    if (!n.title.trim() && !n.body.trim() && !(n.attachments ?? []).length) return "Write a title or some text first.";
    if (n.body.length > MAX_NOTE_BODY) return `A note can be up to ${MAX_NOTE_BODY.toLocaleString("en-US")} characters.`;
  }
  if ((n.attachments ?? []).length > MAX_ATTACHMENTS) return `A note can link up to ${MAX_ATTACHMENTS} files.`;
  return null;
}

/** "ideas, work  plan" to ["ideas", "work", "plan"] without blanks or repeats (case-insensitive), capped at the limit. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\s]+/)) {
    const tag = raw.replace(/^#/, "").trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag.slice(0, MAX_TAG));
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/** Pinned notes first, then most recently edited. */
export function orderNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export type NoteFilter = "all" | "pinned" | "locked";

/** A locked note's text is never searched, so a search can't be used to probe what it says. */
export function searchNotes(notes: Note[], query: string, category: string | null, filter: NoteFilter = "all"): Note[] {
  const q = query.trim().toLowerCase();
  return notes.filter((n) => {
    if (category && n.category !== category) return false;
    if (filter === "pinned" && !n.pinned) return false;
    if (filter === "locked" && !n.locked) return false;
    if (!q) return true;
    const text = n.locked ? "" : `${n.body}\n${(n.items ?? []).map((i) => i.text).join(" ")}\n${(n.attachments ?? []).map((a) => a.name).join(" ")}`;
    return `${n.title}\n${text}\n${n.tags.join(" ")}`.toLowerCase().includes(q);
  });
}

export const noteHeading = (n: Pick<NoteContent, "title" | "body" | "locked" | "kind" | "items">): string => {
  if (n.title.trim()) return n.title.trim();
  if (n.locked) return "Locked note";
  if (noteKind(n) === "DRAWING") return "Drawing";
  if (noteKind(n) === "CHECKLIST") return (n.items ?? []).find((i) => i.text.trim())?.text.trim().slice(0, 60) ?? "Checklist";
  return n.body.trim().split("\n")[0]!.slice(0, 60) || "Untitled";
};

/** What the list shows under a title. A locked note shows nothing of its content. */
export function notePreview(n: Pick<NoteContent, "body" | "locked" | "kind" | "items" | "strokes" | "attachments">): string {
  if (n.locked) return "Locked. Unlock to read.";
  const kind = noteKind(n);
  if (kind === "CHECKLIST") { const p = checklistProgress(n.items); return p.total ? `${p.done} of ${p.total} done` : "Empty checklist"; }
  if (kind === "DRAWING") { const s = (n.strokes ?? []).length; return s ? `Drawing · ${s} ${s === 1 ? "stroke" : "strokes"}` : "Empty drawing"; }
  const text = n.body.replace(/\s+/g, " ").trim().slice(0, 120);
  const files = (n.attachments ?? []).length;
  return text || (files ? `${files} ${files === 1 ? "file" : "files"} attached` : "");
}

/** "Updated 2h ago" style text. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A finger path as compact text: coordinates to one decimal, points closer than `gap` px to the last one dropped. */
export function pointsToPath(points: Array<{ x: number; y: number }>, gap = 1.5): string {
  const kept: Array<{ x: number; y: number }> = [];
  for (const p of points) {
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= gap) kept.push(p);
  }
  const last = points[points.length - 1];
  if (last && kept[kept.length - 1] !== last && kept.length > 1) kept.push(last); // the stroke ends where the finger lifted
  const f = (n: number) => String(Math.round(n * 10) / 10);
  if (kept.length === 1) return `M${f(kept[0]!.x)} ${f(kept[0]!.y)}l0.1 0`; // a tap leaves a dot
  return kept.map((p, i) => `${i ? "L" : "M"}${f(p.x)} ${f(p.y)}`).join("");
}

// Calendar

export const EVENT_COLORS = { blue: "#1677FF", purple: "#8B5CF6", orange: "#F5A524", green: "#22C55E" } as const;
export type EventColor = keyof typeof EVENT_COLORS;
export const EVENT_COLOR_KEYS = Object.keys(EVENT_COLORS) as EventColor[];

export type EventContent = { title: string; location: string; meetingUrl: string; timeZone: string; description: string; color?: EventColor };
export type CalendarEvent = EventContent & { id: string; startsAt: string; endsAt: string };

export const eventColor = (e: Pick<EventContent, "color">): string => EVENT_COLORS[e.color ?? "blue"] ?? EVENT_COLORS.blue;
export const emptyEvent = (): EventContent => ({ title: "", location: "", meetingUrl: "", timeZone: deviceTimeZone(), description: "", color: "blue" });

export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** The first problem with an event, or null. `startsAt` and `endsAt` are Dates built from the person's local choices. */
export function eventProblem(e: EventContent, startsAt: Date | null, endsAt: Date | null): string | null {
  if (!e.title.trim()) return "Give the event a title.";
  if (e.title.length > 200) return "A title can be up to 200 characters.";
  if (!startsAt || !endsAt || Number.isNaN(+startsAt) || Number.isNaN(+endsAt)) return "Choose a start and an end time.";
  if (+endsAt <= +startsAt) return "The event has to end after it starts.";
  if (e.meetingUrl.trim() && !/^https:\/\/\S+$/i.test(e.meetingUrl.trim())) return "A meeting link must start with https://.";
  if (e.location.length > 300 || e.description.length > 10_000) return "That location or description is too long.";
  return null;
}

/** The half-open UTC window [from, to) covering a calendar month in the person's local time. */
export function monthWindow(year: number, month: number): { from: string; to: string } {
  return { from: new Date(year, month, 1).toISOString(), to: new Date(year, month + 1, 1).toISOString() };
}

export type CalendarView = "month" | "week";
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Every day shown for a view, in whole weeks starting Sunday. A month includes the grey days of its neighbours. */
export function viewDays(view: CalendarView, anchor: Date): Date[] {
  if (view === "week") { const first = addDays(startOfDay(anchor), -anchor.getDay()); return Array.from({ length: 7 }, (_, i) => addDays(first, i)); }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = addDays(first, -first.getDay());
  const count = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** The window of events a view needs: from its first day to the day after its last. */
export function viewWindow(view: CalendarView, anchor: Date): { from: string; to: string } {
  const days = viewDays(view, anchor);
  return { from: days[0]!.toISOString(), to: addDays(days[days.length - 1]!, 1).toISOString() };
}

/** Moves the anchor a month or a week. A month step lands on the 1st so short months never overflow. */
export function shiftAnchor(view: CalendarView, anchor: Date, by: number): Date {
  return view === "week" ? addDays(anchor, 7 * by) : new Date(anchor.getFullYear(), anchor.getMonth() + by, 1);
}

export function viewTitle(view: CalendarView, anchor: Date): string {
  if (view === "month") return anchor.toLocaleDateString([], { month: "long", year: "numeric" });
  const days = viewDays("week", anchor), a = days[0]!, b = days[6]!;
  const sameMonth = a.getMonth() === b.getMonth();
  return `${a.toLocaleDateString([], { month: "short", day: "numeric" })} – ${b.toLocaleDateString([], sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
}

/** `YYYY-MM-DD` in local time, the key events are grouped under. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Events grouped by the local day they start on, in time order, days in calendar order. */
export function groupByDay(events: CalendarEvent[]): Array<{ day: string; events: CalendarEvent[] }> {
  const days = new Map<string, CalendarEvent[]>();
  for (const e of [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    const key = dayKey(new Date(e.startsAt));
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  return [...days].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, list]) => ({ day, events: list }));
}

/** Events that haven't ended yet, soonest first. */
export function upcoming(events: CalendarEvent[], now = Date.now()): CalendarEvent[] {
  return events.filter((e) => Date.parse(e.endsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** The line under an event's title: a meeting link reads as a video meeting, otherwise the place. */
export function eventLine(e: Pick<EventContent, "location" | "meetingUrl">): { kind: "video" | "place" | "none"; text: string } {
  if (/^https:\/\//i.test(e.meetingUrl.trim())) return { kind: "video", text: "Video Meeting" };
  if (e.location.trim()) return { kind: "place", text: e.location.trim() };
  return { kind: "none", text: "" };
}

export const REMIND_BEFORE_MINUTES = 15;
/** When a reminder for an event should go off, or null if that moment has passed. */
export function reminderAt(startsAt: string, now = Date.now()): Date | null {
  const at = Date.parse(startsAt) - REMIND_BEFORE_MINUTES * 60_000;
  return Number.isFinite(at) && at > now ? new Date(at) : null;
}

/** Adds a clock time to a local date without touching the original. */
export function atTime(date: Date, hours: number, minutes: number): Date {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

// Enterprise

export const ADMIN_ROLES = ["OWNER", "ADMIN", "SECURITY_ADMIN", "COMPLIANCE_ADMIN"] as const;
export const canSeeAudit = (role: string) => (ADMIN_ROLES as readonly string[]).includes(role);
export const roleLabel = (role: string) => role.toLowerCase().split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

/** A policy value for display: plain values as written, objects as compact text. */
export function policyValueText(value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value).slice(0, 160);
}

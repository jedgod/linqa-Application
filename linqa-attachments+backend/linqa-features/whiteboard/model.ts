// Shared whiteboard state that two (or more) people edit at the same time.
//
// Every element carries a Lamport clock. When two edits to the same element
// race, the higher clock wins (ties broken by author id), so every device ends
// up with the same board no matter what order messages arrive in. Deletes are
// tombstones so a late "upsert" can't resurrect something that was erased.
// Undo/redo only touch your own actions, like Zoom and Webex whiteboards.

export type Point = [number, number];

export interface Clock { c: number; a: string }

interface Base {
  id: string;
  author: string;
  clock: Clock;
  deleted?: boolean;
  /** Fractional ordering for z-index; higher draws on top. */
  z: number;
}

export interface StrokeEl extends Base { kind: "stroke"; points: Point[]; color: string; width: number; highlighter?: boolean }
export interface ShapeEl extends Base {
  kind: "rect" | "ellipse" | "line" | "arrow";
  x1: number; y1: number; x2: number; y2: number;
  color: string; width: number; fill?: string;
}
export interface TextEl extends Base { kind: "text"; x: number; y: number; text: string; color: string; size: number }
export interface StickyEl extends Base { kind: "sticky"; x: number; y: number; w: number; h: number; text: string; color: string }

export type Element = StrokeEl | ShapeEl | TextEl | StickyEl;
export type ElementKind = Element["kind"];

export type Op =
  | { op: "upsert"; el: Element }
  | { op: "delete"; id: string; clock: Clock };

/** What goes over the encrypted data channel. */
/** "board" is the whiteboard; "screen" is the annotation layer over a shared screen. */
export type Layer = "board" | "screen";

export type WireMessage =
  | { t: "ops"; layer: Layer; ops: Op[] }
  | { t: "sync"; layer: Layer; els: Element[] }
  | { t: "presence"; author: string; name: string; x: number; y: number; laser: boolean }
  | { t: "lock"; locked: boolean; by: string }
  | { t: "screen"; on: boolean; trackId?: string };

const LIMITS = { points: 4000, text: 2000, elements: 5000, coord: 1e6, width: 200 };

export function newer(a: Clock, b: Clock): boolean {
  return a.c > b.c || (a.c === b.c && a.a > b.a);
}

interface HistoryEntry { before: Element | null; after: Element | null }

export class Board {
  private els = new Map<string, Element>();
  private graves = new Map<string, Clock>();
  private clock = 0;
  private undoStack: HistoryEntry[][] = [];
  private redoStack: HistoryEntry[][] = [];
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(public readonly me: string) {}

  // --- reading ------------------------------------------------------------

  /** Visible elements, bottom to top. */
  elements(): Element[] {
    return [...this.els.values()].filter((e) => !e.deleted).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
  }
  get(id: string): Element | undefined {
    const e = this.els.get(id);
    return e && !e.deleted ? e : undefined;
  }
  /** Every element including tombstones, for syncing a late joiner. */
  snapshot(): Element[] {
    return [...this.els.values()];
  }
  getVersion() {
    return this.version;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  // --- local edits (return ops to broadcast) -------------------------------

  private tick(): Clock {
    this.clock += 1;
    return { c: this.clock, a: this.me };
  }

  topZ(): number {
    let z = 0;
    for (const e of this.els.values()) if (e.z > z) z = e.z;
    return z;
  }

  /** Add a new element. `draft` is everything except id/author/clock/z. */
  add<T extends Element>(draft: DistributiveOmit<T, "author" | "clock" | "z"> & { id: string }): Op[] {
    const el = { ...draft, author: this.me, clock: this.tick(), z: this.topZ() + 1 } as Element;
    return this.commit([{ before: null, after: el }]);
  }

  /** Change fields of existing elements (move, recolor, edit text). */
  update(changes: { id: string; patch: Partial<Element> }[]): Op[] {
    const entries: HistoryEntry[] = [];
    for (const { id, patch } of changes) {
      const before = this.get(id);
      if (!before) continue;
      const after = { ...before, ...patch, id, author: before.author, clock: this.tick() } as Element;
      entries.push({ before, after });
    }
    return this.commit(entries);
  }

  remove(ids: string[]): Op[] {
    const entries: HistoryEntry[] = [];
    for (const id of ids) {
      const before = this.get(id);
      if (before) entries.push({ before, after: { ...before, deleted: true, clock: this.tick() } });
    }
    return this.commit(entries);
  }

  /** "Clear mine" removes only your elements; "Clear all" is for the host. */
  clear(scope: "mine" | "all"): Op[] {
    const ids = this.elements().filter((e) => scope === "all" || e.author === this.me).map((e) => e.id);
    return this.remove(ids);
  }

  bringToFront(ids: string[]): Op[] {
    let z = this.topZ();
    return this.update(ids.map((id) => ({ id, patch: { z: ++z } })));
  }

  undo(): Op[] {
    const batch = this.undoStack.pop();
    if (!batch) return [];
    const inverse = batch
      .slice()
      .reverse()
      .map(({ before, after }) => this.revert(after, before));
    this.redoStack.push(inverse.filter(Boolean) as HistoryEntry[]);
    return this.apply(inverse.filter(Boolean) as HistoryEntry[]);
  }

  redo(): Op[] {
    const batch = this.redoStack.pop();
    if (!batch) return [];
    const inverse = batch
      .slice()
      .reverse()
      .map(({ before, after }) => this.revert(after, before));
    this.undoStack.push(inverse.filter(Boolean) as HistoryEntry[]);
    return this.apply(inverse.filter(Boolean) as HistoryEntry[]);
  }

  /** Builds an entry that changes `from` back to `to`, with a fresh clock. */
  private revert(from: Element | null, to: Element | null): HistoryEntry | null {
    const id = (from ?? to)!.id;
    const current = this.els.get(id) ?? null;
    const target: Element = to
      ? { ...to, deleted: false, clock: this.tick() }
      : { ...(current ?? from!), deleted: true, clock: this.tick() };
    return { before: current && !current.deleted ? current : null, after: target };
  }

  private commit(entries: HistoryEntry[]): Op[] {
    if (!entries.length) return [];
    this.undoStack.push(entries);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    return this.apply(entries);
  }

  private apply(entries: HistoryEntry[]): Op[] {
    const ops: Op[] = entries.map(({ after }) =>
      after!.deleted ? { op: "delete", id: after!.id, clock: after!.clock } : { op: "upsert", el: after! }
    );
    for (const e of entries) this.els.set(e.after!.id, e.after!);
    this.changed();
    return ops;
  }

  // --- remote edits ----------------------------------------------------------

  /**
   * Applies ops from another participant. Invalid or oversized ops are
   * dropped. `allowAuthor` lets the session enforce "only host can draw".
   */
  receive(ops: unknown[], from: string, allowAuthor: (author: string) => boolean = () => true): number {
    let applied = 0;
    for (const raw of ops) {
      const op = sanitizeOp(raw);
      if (!op) continue;
      if (op.op === "upsert") {
        // Peers may only create elements as themselves, but may edit others'.
        const existing = this.els.get(op.el.id);
        if (!existing && op.el.author !== from) continue;
        if (existing && op.el.author !== existing.author) continue;
        if (op.el.clock.a !== from || !allowAuthor(from)) continue;
        if (this.mergeEl(op.el)) applied++;
      } else {
        if (op.clock.a !== from || !allowAuthor(from)) continue;
        const existing = this.els.get(op.id);
        if (!existing) {
          // Delete arrived before the element did: remember it so the
          // element is born deleted instead of reappearing.
          const grave = this.graves.get(op.id);
          if (!grave || newer(op.clock, grave)) this.graves.set(op.id, op.clock);
          this.seen(op.clock);
          continue;
        }
        if (!newer(op.clock, existing.clock)) {
          this.seen(op.clock);
          continue;
        }
        this.els.set(op.id, { ...existing, deleted: true, clock: op.clock });
        this.seen(op.clock);
        applied++;
      }
    }
    if (applied) this.changed();
    return applied;
  }

  /** Merge a full snapshot (late join or reconnect). */
  receiveSync(els: unknown[]): number {
    let applied = 0;
    for (const raw of els.slice(0, LIMITS.elements)) {
      const el = sanitizeEl(raw);
      if (el && this.mergeEl(el)) applied++;
    }
    if (applied) this.changed();
    return applied;
  }

  private mergeEl(el: Element): boolean {
    this.seen(el.clock);
    const existing = this.els.get(el.id);
    if (existing && !newer(el.clock, existing.clock)) return false;
    if (!existing && this.els.size >= LIMITS.elements) return false;
    const grave = this.graves.get(el.id);
    if (grave && newer(grave, el.clock)) {
      this.els.set(el.id, { ...el, deleted: true, clock: grave });
      this.graves.delete(el.id);
      return true;
    }
    this.els.set(el.id, el);
    return true;
  }

  private seen(clock: Clock) {
    if (clock.c > this.clock) this.clock = clock.c;
  }

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

// --- validation of anything that came over the wire --------------------------

function sanitizeOp(raw: unknown): Op | null {
  if (!isObj(raw)) return null;
  if (raw.op === "upsert") {
    const el = sanitizeEl(raw.el);
    return el ? { op: "upsert", el } : null;
  }
  if (raw.op === "delete" && typeof raw.id === "string" && raw.id.length <= 64) {
    const clock = sanitizeClock(raw.clock);
    return clock ? { op: "delete", id: raw.id, clock } : null;
  }
  return null;
}

export function sanitizeEl(raw: unknown): Element | null {
  if (!isObj(raw)) return null;
  const clock = sanitizeClock(raw.clock);
  if (!clock || typeof raw.id !== "string" || raw.id.length > 64 || typeof raw.author !== "string" || raw.author.length > 128) return null;
  if (!fin(raw.z)) return null;
  const base = { id: raw.id, author: raw.author, clock, z: raw.z as number, deleted: raw.deleted === true || undefined };
  const color = (x: unknown) => typeof x === "string" && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(x);

  switch (raw.kind) {
    case "stroke": {
      if (!Array.isArray(raw.points) || raw.points.length < 1 || raw.points.length > LIMITS.points) return null;
      if (!raw.points.every((p) => Array.isArray(p) && p.length === 2 && coord(p[0]) && coord(p[1]))) return null;
      if (!color(raw.color) || !width(raw.width)) return null;
      return { ...base, kind: "stroke", points: raw.points as Point[], color: raw.color as string, width: raw.width as number, highlighter: raw.highlighter === true || undefined };
    }
    case "rect":
    case "ellipse":
    case "line":
    case "arrow":
      if (![raw.x1, raw.y1, raw.x2, raw.y2].every(coord) || !color(raw.color) || !width(raw.width)) return null;
      if (raw.fill !== undefined && !color(raw.fill)) return null;
      return { ...base, kind: raw.kind, x1: raw.x1 as number, y1: raw.y1 as number, x2: raw.x2 as number, y2: raw.y2 as number, color: raw.color as string, width: raw.width as number, fill: raw.fill as string | undefined };
    case "text":
      if (!coord(raw.x) || !coord(raw.y) || typeof raw.text !== "string" || raw.text.length > LIMITS.text || !color(raw.color) || !fin(raw.size) || (raw.size as number) < 6 || (raw.size as number) > 400) return null;
      return { ...base, kind: "text", x: raw.x as number, y: raw.y as number, text: raw.text, color: raw.color as string, size: raw.size as number };
    case "sticky":
      if (![raw.x, raw.y].every(coord) || !fin(raw.w) || !fin(raw.h) || (raw.w as number) < 20 || (raw.h as number) < 20 || (raw.w as number) > 2000 || (raw.h as number) > 2000) return null;
      if (typeof raw.text !== "string" || raw.text.length > LIMITS.text || !color(raw.color)) return null;
      return { ...base, kind: "sticky", x: raw.x as number, y: raw.y as number, w: raw.w as number, h: raw.h as number, text: raw.text, color: raw.color as string };
    default:
      return null;
  }
}

function sanitizeClock(raw: unknown): Clock | null {
  return isObj(raw) && Number.isSafeInteger(raw.c) && (raw.c as number) >= 0 && typeof raw.a === "string" && raw.a.length <= 128
    ? { c: raw.c as number, a: raw.a }
    : null;
}
function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function fin(x: unknown) {
  return typeof x === "number" && Number.isFinite(x);
}
function coord(x: unknown) {
  return fin(x) && Math.abs(x as number) <= LIMITS.coord;
}
function width(x: unknown) {
  return fin(x) && (x as number) > 0 && (x as number) <= LIMITS.width;
}

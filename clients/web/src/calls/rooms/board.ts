/**
 * Shared board model. Strokes travel over the WebRTC data channel
 * (DTLS, peer to peer), never through the server.
 * Coordinates are normalised to 0..1 so every screen size lines up.
 */

export const BRUSHES = ['pen', 'calligraphy-brush', 'calligraphy-pen', 'airbrush', 'crayon', 'oil', 'marker', 'natural-pencil'] as const;
export type Brush = (typeof BRUSHES)[number];
const BRUSH_SET = new Set<string>(BRUSHES);

export interface Stroke {
  id: string;
  author: string; // participantId
  color: string;
  width: number; // fraction of board width
  points: number[]; // [x0, y0, x1, y1, ...] in 0..1
  done: boolean;
  brush: Brush;
}

export interface TextItem {
  id: string;
  author: string;
  x: number; // 0..1, left of the text
  y: number; // 0..1, baseline
  text: string;
  color: string;
  size: number; // fraction of board width
}

export type BoardOp =
  | { t: 'board-open'; by: string; at: number }
  | { t: 'board-close'; by: string }
  | { t: 'stroke-pts'; id: string; color: string; width: number; pts: number[]; brush?: Brush }
  | { t: 'stroke-done'; id: string }
  | { t: 'stroke-undo'; id: string }
  | { t: 'stroke-erase'; id: string }
  | { t: 'stroke-fill'; id: string; color: string | null }
  | { t: 'text-add'; id: string; x: number; y: number; text: string; color: string; size: number }
  | { t: 'text-remove'; id: string }
  | { t: 'board-bg'; color: string | null }
  | { t: 'board-clear'; by: string }
  | { t: 'board-sync'; openedBy: string; openedAt: number; strokes: Stroke[]; texts?: TextItem[]; fills?: Record<string, string>; bg?: string | null };

export interface BoardState {
  open: boolean;
  openedBy: string | null;
  openedAt: number;
  strokes: Stroke[];
  texts: TextItem[];
  /** Closed shapes filled with a colour, by stroke id. */
  fills: Record<string, string>;
  /** Background colour everyone sees. Null is the default dark board. */
  bg: string | null;
}

export const BOARD_LIMITS = {
  maxStrokes: 2000,
  maxTexts: 200,
  maxTextLength: 200,
  maxPointsPerStroke: 4000, // values, i.e. 2000 points
  maxPtsPerMessage: 400,
  colors: ['#F5F5F7', '#FFD60A', '#FF6B6B', '#4CD3A5', '#5AA9FF', '#C08BFF'],
} as const;

export const emptyBoard = (): BoardState => ({ open: false, openedBy: null, openedAt: 0, strokes: [], texts: [], fills: {}, bg: null });

const isNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const okColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

/**
 * Applies an op from `from` (a participantId verified by the transport).
 * Returns a new state, or the same object when the op is ignored.
 * Authors can only extend, finish or undo their own strokes; the person who opened the board can also erase anyone's.
 */
export function applyBoardOp(s: BoardState, op: BoardOp, from: string): BoardState {
  switch (op.t) {
    case 'board-open':
      if (s.open) return s;
      return { ...emptyBoard(), open: true, openedBy: from, openedAt: isNum(op.at) ? op.at : Date.now() };

    case 'board-close':
      if (!s.open || s.openedBy !== from) return s;
      return emptyBoard();

    case 'board-clear':
      if (!s.open || s.openedBy !== from) return s;
      return { ...s, strokes: [], texts: [], fills: {}, bg: null };

    case 'stroke-pts': {
      if (!s.open || typeof op.id !== 'string' || !Array.isArray(op.pts)) return s;
      if (op.pts.length % 2 !== 0 || op.pts.length > BOARD_LIMITS.maxPtsPerMessage) return s;
      if (!op.pts.every(isNum) || !okColor(op.color) || !isNum(op.width)) return s;
      const pts = op.pts.map(clamp01);
      const idx = s.strokes.findIndex((k) => k.id === op.id);
      if (idx === -1) {
        if (s.strokes.length >= BOARD_LIMITS.maxStrokes) return s;
        const width = Math.min(0.05, Math.max(0.001, op.width));
        const brush: Brush = typeof op.brush === 'string' && BRUSH_SET.has(op.brush) ? op.brush : 'pen';
        return {
          ...s,
          strokes: [...s.strokes, { id: op.id, author: from, color: op.color, width, points: pts, done: false, brush }],
        };
      }
      const k = s.strokes[idx];
      if (k.author !== from || k.done) return s;
      if (k.points.length + pts.length > BOARD_LIMITS.maxPointsPerStroke) return s;
      const strokes = s.strokes.slice();
      strokes[idx] = { ...k, points: k.points.concat(pts) };
      return { ...s, strokes };
    }

    case 'stroke-done': {
      const idx = s.strokes.findIndex((k) => k.id === op.id);
      if (idx === -1 || s.strokes[idx].author !== from) return s;
      const strokes = s.strokes.slice();
      strokes[idx] = { ...strokes[idx], done: true };
      return { ...s, strokes };
    }

    case 'stroke-undo': {
      const k = s.strokes.find((x) => x.id === op.id);
      if (!k || k.author !== from) return s;
      return withoutStroke(s, op.id);
    }

    case 'stroke-erase': {
      if (!s.open) return s;
      const k = s.strokes.find((x) => x.id === op.id);
      if (!k || (k.author !== from && s.openedBy !== from)) return s;
      return withoutStroke(s, op.id);
    }

    case 'stroke-fill': {
      if (!s.open || !s.strokes.some((x) => x.id === op.id)) return s;
      if (op.color !== null && !okColor(op.color)) return s;
      const fills = { ...s.fills };
      if (op.color === null) delete fills[op.id];
      else fills[op.id] = op.color;
      return { ...s, fills };
    }

    case 'text-add': {
      if (!s.open || typeof op.id !== 'string' || typeof op.text !== 'string') return s;
      if (s.texts.length >= BOARD_LIMITS.maxTexts || s.texts.some((t) => t.id === op.id)) return s;
      const text = op.text.slice(0, BOARD_LIMITS.maxTextLength);
      if (!text.trim() || !okColor(op.color) || !isNum(op.x) || !isNum(op.y) || !isNum(op.size)) return s;
      const size = Math.min(0.2, Math.max(0.015, op.size));
      return { ...s, texts: [...s.texts, { id: op.id, author: from, x: clamp01(op.x), y: clamp01(op.y), text, color: op.color, size }] };
    }

    case 'text-remove': {
      const t = s.texts.find((x) => x.id === op.id);
      if (!s.open || !t || (t.author !== from && s.openedBy !== from)) return s;
      return { ...s, texts: s.texts.filter((x) => x.id !== op.id) };
    }

    case 'board-bg': {
      if (!s.open) return s;
      if (op.color !== null && !okColor(op.color)) return s;
      return s.bg === op.color ? s : { ...s, bg: op.color };
    }

    case 'board-sync': {
      // Sent by the opener to people who join mid-board.
      if (s.open || typeof op.openedBy !== 'string' || op.openedBy !== from) return s;
      if (!Array.isArray(op.strokes)) return s;
      let next: BoardState = { ...emptyBoard(), open: true, openedBy: op.openedBy, openedAt: op.openedAt };
      for (const k of op.strokes.slice(0, BOARD_LIMITS.maxStrokes)) {
        if (!k || typeof k.author !== 'string' || !Array.isArray(k.points)) continue;
        for (let i = 0; i < k.points.length && i < BOARD_LIMITS.maxPointsPerStroke; i += BOARD_LIMITS.maxPtsPerMessage) {
          next = applyBoardOp(
            next,
            { t: 'stroke-pts', id: k.id, color: k.color, width: k.width, pts: k.points.slice(i, i + BOARD_LIMITS.maxPtsPerMessage), ...(k.brush ? { brush: k.brush } : {}) },
            k.author,
          );
        }
        if (k.done) next = applyBoardOp(next, { t: 'stroke-done', id: k.id }, k.author);
      }
      for (const t of Array.isArray(op.texts) ? op.texts.slice(0, BOARD_LIMITS.maxTexts) : []) {
        if (t && typeof t.author === 'string') next = applyBoardOp(next, { t: 'text-add', id: t.id, x: t.x, y: t.y, text: t.text, color: t.color, size: t.size }, t.author);
      }
      if (op.fills && typeof op.fills === 'object') {
        for (const [id, color] of Object.entries(op.fills)) next = applyBoardOp(next, { t: 'stroke-fill', id, color }, from);
      }
      if (op.bg !== undefined) next = applyBoardOp(next, { t: 'board-bg', color: op.bg }, from);
      return next;
    }
    default:
      return s;
  }
}

function withoutStroke(s: BoardState, id: string): BoardState {
  const fills = { ...s.fills };
  delete fills[id];
  return { ...s, strokes: s.strokes.filter((x) => x.id !== id), fills };
}

/** The opener leaving closes the board for everyone. */
export function onParticipantGone(s: BoardState, participantId: string, replacedBy?: string): BoardState {
  if (!s.open || s.openedBy !== participantId) return s;
  return replacedBy ? { ...s, openedBy: replacedBy } : emptyBoard();
}

export function pathFor(points: number[], w: number, h: number): string {
  if (points.length < 2) return '';
  let d = `M${(points[0] * w).toFixed(1)} ${(points[1] * h).toFixed(1)}`;
  if (points.length === 2) return d + ` l0.1 0`;
  for (let i = 2; i < points.length; i += 2) d += ` L${(points[i] * w).toFixed(1)} ${(points[i + 1] * h).toFixed(1)}`;
  return d;
}

/* ---------------- hit testing (used by the eraser, fill, and colour picker) ---------------- */

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The topmost stroke within `tol` pixels of the point (x, y in pixels of a w by h board). */
export function strokeAt(strokes: Stroke[], x: number, y: number, w: number, h: number, tol: number): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const k = strokes[i];
    const reach = tol + (k.width * w) / 2;
    const p = k.points;
    if (p.length === 2 && Math.hypot(x - p[0] * w, y - p[1] * h) <= reach) return k;
    for (let j = 0; j + 3 < p.length; j += 2) {
      if (distToSegment(x, y, p[j] * w, p[j + 1] * h, p[j + 2] * w, p[j + 3] * h) <= reach) return k;
    }
  }
  return null;
}

/** The topmost text item whose box contains the point. */
export function textAt(texts: TextItem[], x: number, y: number, w: number, h: number): TextItem | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    const size = t.size * w;
    const width = t.text.length * size * 0.55;
    const left = t.x * w;
    const baseline = t.y * h;
    if (x >= left - 6 && x <= left + width + 6 && y >= baseline - size - 6 && y <= baseline + size * 0.3 + 6) return t;
  }
  return null;
}

/** True when the stroke ends near where it began, so it can hold a fill. */
export function isClosedish(k: Stroke, w: number, h: number): boolean {
  const p = k.points;
  if (p.length < 8) return false;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i] * w); maxX = Math.max(maxX, p[i] * w);
    minY = Math.min(minY, p[i + 1] * h); maxY = Math.max(maxY, p[i + 1] * h);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  return diag > 24 && Math.hypot((p[0] - p[p.length - 2]) * w, (p[1] - p[p.length - 1]) * h) <= diag * 0.22;
}

/** Point-in-polygon (even-odd) for a stroke treated as a closed shape. */
export function strokeContains(k: Stroke, x: number, y: number, w: number, h: number): boolean {
  const p = k.points;
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i] * w, yi = p[i + 1] * h, xj = p[j] * w, yj = p[j + 1] * h;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The topmost closed shape that holds the point. */
export function fillableAt(strokes: Stroke[], x: number, y: number, w: number, h: number): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const k = strokes[i];
    if (isClosedish(k, w, h) && strokeContains(k, x, y, w, h)) return k;
  }
  return null;
}

/**
 * Shared board model. Strokes travel over the WebRTC data channel
 * (DTLS, peer to peer), never through the server.
 * Coordinates are normalised to 0..1 so every screen size lines up.
 */

export interface Stroke {
  id: string;
  author: string; // participantId
  color: string;
  width: number; // fraction of board width
  points: number[]; // [x0, y0, x1, y1, ...] in 0..1
  done: boolean;
}

export type BoardOp =
  | { t: 'board-open'; by: string; at: number }
  | { t: 'board-close'; by: string }
  | { t: 'stroke-pts'; id: string; color: string; width: number; pts: number[] }
  | { t: 'stroke-done'; id: string }
  | { t: 'stroke-undo'; id: string }
  | { t: 'board-clear'; by: string }
  | { t: 'board-sync'; openedBy: string; openedAt: number; strokes: Stroke[] };

export interface BoardState {
  open: boolean;
  openedBy: string | null;
  openedAt: number;
  strokes: Stroke[];
}

export const BOARD_LIMITS = {
  maxStrokes: 2000,
  maxPointsPerStroke: 4000, // values, i.e. 2000 points
  maxPtsPerMessage: 400,
  colors: ['#F5F5F7', '#FFD60A', '#FF6B6B', '#4CD3A5', '#5AA9FF', '#C08BFF'],
} as const;

export const emptyBoard = (): BoardState => ({ open: false, openedBy: null, openedAt: 0, strokes: [] });

const isNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const okColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

/**
 * Applies an op from `from` (a participantId verified by the transport).
 * Returns a new state, or the same object when the op is ignored.
 * Authors can only extend, finish or undo their own strokes.
 */
export function applyBoardOp(s: BoardState, op: BoardOp, from: string): BoardState {
  switch (op.t) {
    case 'board-open':
      if (s.open) return s;
      return { open: true, openedBy: from, openedAt: isNum(op.at) ? op.at : Date.now(), strokes: [] };

    case 'board-close':
      if (!s.open || s.openedBy !== from) return s;
      return emptyBoard();

    case 'board-clear':
      if (!s.open || s.openedBy !== from) return s;
      return { ...s, strokes: [] };

    case 'stroke-pts': {
      if (!s.open || typeof op.id !== 'string' || !Array.isArray(op.pts)) return s;
      if (op.pts.length % 2 !== 0 || op.pts.length > BOARD_LIMITS.maxPtsPerMessage) return s;
      if (!op.pts.every(isNum) || !okColor(op.color) || !isNum(op.width)) return s;
      const pts = op.pts.map(clamp01);
      const idx = s.strokes.findIndex((k) => k.id === op.id);
      if (idx === -1) {
        if (s.strokes.length >= BOARD_LIMITS.maxStrokes) return s;
        const width = Math.min(0.05, Math.max(0.001, op.width));
        return {
          ...s,
          strokes: [...s.strokes, { id: op.id, author: from, color: op.color, width, points: pts, done: false }],
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
      return { ...s, strokes: s.strokes.filter((x) => x.id !== op.id) };
    }

    case 'board-sync': {
      // Sent by the opener to people who join mid-board.
      if (s.open || typeof op.openedBy !== 'string' || op.openedBy !== from) return s;
      if (!Array.isArray(op.strokes)) return s;
      let next: BoardState = { open: true, openedBy: op.openedBy, openedAt: op.openedAt, strokes: [] };
      for (const k of op.strokes.slice(0, BOARD_LIMITS.maxStrokes)) {
        if (!k || typeof k.author !== 'string' || !Array.isArray(k.points)) continue;
        for (let i = 0; i < k.points.length && i < BOARD_LIMITS.maxPointsPerStroke; i += BOARD_LIMITS.maxPtsPerMessage) {
          next = applyBoardOp(
            next,
            { t: 'stroke-pts', id: k.id, color: k.color, width: k.width, pts: k.points.slice(i, i + BOARD_LIMITS.maxPtsPerMessage) },
            k.author,
          );
        }
        if (k.done) next = applyBoardOp(next, { t: 'stroke-done', id: k.id }, k.author);
      }
      return next;
    }
    default:
      return s;
  }
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

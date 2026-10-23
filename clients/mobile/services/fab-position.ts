/**
 * Where a draggable floating button sits. A position is stored as an edge plus how far down the free space the button is
 * (0 at the top, 1 at the bottom), so it still makes sense after a rotation, a keyboard or a different screen size.
 */
export type Size = { w: number; h: number };
export type FabPosition = { side: "left" | "right"; y: number };
export type Offsets = { x: number; y: number };

export const DEFAULT_POSITION: FabPosition = { side: "right", y: 1 };

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

/** Top-left pixel position for a stored position, inside the bounds and `margin` from every edge. */
export function toOffsets(pos: FabPosition, bounds: Size, fab: Size, margin: number, bottomInset = 0): Offsets {
  const minY = margin, maxY = bounds.h - fab.h - margin - bottomInset;
  return {
    x: pos.side === "left" ? margin : Math.max(margin, bounds.w - fab.w - margin),
    y: clamp(minY + pos.y * (maxY - minY), minY, maxY)
  };
}

/** Keeps a dragged button fully on screen. */
export function clampOffsets(o: Offsets, bounds: Size, fab: Size, margin: number, bottomInset = 0): Offsets {
  return { x: clamp(o.x, margin, bounds.w - fab.w - margin), y: clamp(o.y, margin, bounds.h - fab.h - margin - bottomInset) };
}

/** Where a released button settles: the nearer side edge, keeping its height. */
export function snapPosition(o: Offsets, bounds: Size, fab: Size, margin: number, bottomInset = 0): FabPosition {
  const c = clampOffsets(o, bounds, fab, margin, bottomInset);
  const minY = margin, maxY = bounds.h - fab.h - margin - bottomInset;
  return { side: c.x + fab.w / 2 < bounds.w / 2 ? "left" : "right", y: maxY > minY ? (c.y - minY) / (maxY - minY) : 1 };
}

export const serializePosition = (p: FabPosition) => JSON.stringify({ side: p.side, y: Math.round(p.y * 1000) / 1000 });

/** A saved position, or null if what was stored isn't one. */
export function parsePosition(text: string | null | undefined): FabPosition | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<FabPosition>;
    if ((v.side === "left" || v.side === "right") && typeof v.y === "number" && Number.isFinite(v.y)) return { side: v.side, y: clamp(v.y, 0, 1) };
  } catch { /* fall through */ }
  return null;
}

/** A tap is a touch that barely moved. Anything further is a drag. */
export const isDrag = (dx: number, dy: number, slop = 8) => Math.hypot(dx, dy) > slop;

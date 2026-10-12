/**
 * The board's view: rotate, resize, skew and zoom. These change how the drawing is shown (and exported) on this phone only; the
 * strokes everyone shares keep their own coordinates. A 2x3 affine matrix [a, b, c, d, e, f] maps (x, y) to
 * (a*x + c*y + e, b*x + d*y + f).
 */

export type Matrix = [number, number, number, number, number, number];

export interface BoardTransform {
  /** Degrees, clockwise. */
  rotation: number;
  /** 1 is the board's own size. */
  scale: number;
  skewX: number;
  skewY: number;
  /** Magnifier. */
  zoom: number;
  panX: number;
  panY: number;
}

export const IDENTITY_VIEW: BoardTransform = { rotation: 0, scale: 1, skewX: 0, skewY: 0, zoom: 1, panX: 0, panY: 0 };

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Applies `second` after `first`. */
export function compose(second: Matrix, first: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = second;
  const [a2, b2, c2, d2, e2, f2] = first;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

export function invert(m: Matrix): Matrix | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** The view as one matrix for a board of w by h pixels, turning around the board's centre. */
export function viewMatrix(v: BoardTransform, w: number, h: number): Matrix {
  const cx = w / 2;
  const cy = h / 2;
  const toCentre: Matrix = [1, 0, 0, 1, -cx, -cy];
  const scale = v.scale * v.zoom;
  const scaling: Matrix = [scale, 0, 0, scale, 0, 0];
  const skew: Matrix = [1, Math.tan(rad(v.skewY)), Math.tan(rad(v.skewX)), 1, 0, 0];
  const r = rad(v.rotation);
  const rotate: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
  const back: Matrix = [1, 0, 0, 1, cx + v.panX, cy + v.panY];
  return compose(back, compose(rotate, compose(skew, compose(scaling, toCentre))));
}

export function matrixString(m: Matrix): string {
  return `matrix(${m.map((n) => n.toFixed(5)).join(' ')})`;
}

export const clampScale = (n: number) => Math.min(3, Math.max(0.25, n));
export const clampSkew = (n: number) => Math.min(60, Math.max(-60, n));
export const normalizeDegrees = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;
export const ZOOM_STEPS = [1, 2, 4, 8];

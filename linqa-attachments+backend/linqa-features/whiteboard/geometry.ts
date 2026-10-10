// Camera (zoom/pan), hit testing and stroke simplification. Pure functions.

import { Element, Point } from "./model";

export interface Camera { x: number; y: number; zoom: number } // world point at screen (0,0), and scale
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export const screenToWorld = (cam: Camera, sx: number, sy: number): Point => [cam.x + sx / cam.zoom, cam.y + sy / cam.zoom];
export const worldToScreen = (cam: Camera, wx: number, wy: number): Point => [(wx - cam.x) * cam.zoom, (wy - cam.y) * cam.zoom];

/** Zoom by `factor` keeping the world point under (sx, sy) fixed: pinch and +/- buttons. */
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  const [wx, wy] = screenToWorld(cam, sx, sy);
  return { zoom, x: wx - sx / zoom, y: wy - sy / zoom };
}

export function pan(cam: Camera, dsx: number, dsy: number): Camera {
  return { ...cam, x: cam.x - dsx / cam.zoom, y: cam.y - dsy / cam.zoom };
}

export function elementBounds(e: Element): Bounds {
  switch (e.kind) {
    case "stroke": {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of e.points) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const r = e.width / 2;
      return { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r };
    }
    case "text": {
      const lines = e.text.split("\n");
      const w = Math.max(...lines.map((l) => l.length)) * e.size * 0.6;
      return { minX: e.x, minY: e.y, maxX: e.x + w, maxY: e.y + lines.length * e.size * 1.25 };
    }
    case "sticky":
      return { minX: e.x, minY: e.y, maxX: e.x + e.w, maxY: e.y + e.h };
    default:
      return {
        minX: Math.min(e.x1, e.x2) - e.width / 2,
        minY: Math.min(e.y1, e.y2) - e.width / 2,
        maxX: Math.max(e.x1, e.x2) + e.width / 2,
        maxY: Math.max(e.y1, e.y2) + e.width / 2,
      };
  }
}

export function unionBounds(els: Element[]): Bounds | null {
  if (!els.length) return null;
  return els.map(elementBounds).reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

/** Camera that shows every element with some padding ("Fit to screen"). */
export function fitCamera(els: Element[], viewW: number, viewH: number, pad = 40): Camera {
  const b = unionBounds(els);
  if (!b) return { x: -viewW / 2, y: -viewH / 2, zoom: 1 };
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((viewW - pad * 2) / w, (viewH - pad * 2) / h)));
  return { zoom, x: b.minX - (viewW / zoom - w) / 2, y: b.minY - (viewH / zoom - h) / 2 };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True if world point (x, y) touches the element, within `slop` world units. */
export function hitTest(e: Element, x: number, y: number, slop: number): boolean {
  const b = elementBounds(e);
  if (x < b.minX - slop || x > b.maxX + slop || y < b.minY - slop || y > b.maxY + slop) return false;
  switch (e.kind) {
    case "stroke": {
      const r = e.width / 2 + slop;
      if (e.points.length === 1) return Math.hypot(x - e.points[0][0], y - e.points[0][1]) <= r;
      for (let i = 1; i < e.points.length; i++) {
        const [ax, ay] = e.points[i - 1];
        const [bx, by] = e.points[i];
        if (distToSegment(x, y, ax, ay, bx, by) <= r) return true;
      }
      return false;
    }
    case "line":
    case "arrow":
      return distToSegment(x, y, e.x1, e.y1, e.x2, e.y2) <= e.width / 2 + slop;
    case "ellipse": {
      const cx = (e.x1 + e.x2) / 2, cy = (e.y1 + e.y2) / 2;
      const rx = Math.abs(e.x2 - e.x1) / 2 || 1, ry = Math.abs(e.y2 - e.y1) / 2 || 1;
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (e.fill) return d <= 1.05;
      const edge = (e.width / 2 + slop) / Math.min(rx, ry);
      return Math.abs(Math.sqrt(d) - 1) <= edge;
    }
    case "rect": {
      if (e.fill) return true; // inside bounds already
      const minX = Math.min(e.x1, e.x2), maxX = Math.max(e.x1, e.x2);
      const minY = Math.min(e.y1, e.y2), maxY = Math.max(e.y1, e.y2);
      const r = e.width / 2 + slop;
      return Math.abs(x - minX) <= r || Math.abs(x - maxX) <= r || Math.abs(y - minY) <= r || Math.abs(y - maxY) <= r;
    }
    default:
      return true; // text and sticky: bounds are the hit area
  }
}

/** Topmost element under the point. */
export function pick(els: Element[], x: number, y: number, slop: number): Element | null {
  for (let i = els.length - 1; i >= 0; i--) if (hitTest(els[i], x, y, slop)) return els[i];
  return null;
}

/** Elements whose bounds intersect a marquee. */
export function inMarquee(els: Element[], a: Point, b: Point): Element[] {
  const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
  return els.filter((e) => {
    const bb = elementBounds(e);
    return bb.minX <= maxX && bb.maxX >= minX && bb.minY <= maxY && bb.maxY >= minY;
  });
}

/** Ramer-Douglas-Peucker: fewer points, same look. Keeps strokes small on the wire. */
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i][0], points[i][1], points[s][0], points[s][1], points[e][0], points[e][1]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Smooth SVG path through points using quadratic midpoints. */
export function strokePath(points: Point[]): string {
  if (!points.length) return "";
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M${x} ${y}L${x + 0.01} ${y}`;
  }
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = points[points.length - 1];
  return d + `L${last[0]} ${last[1]}`;
}

/** Arrowhead triangle for an arrow from (x1,y1) to (x2,y2). */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number): string {
  const len = Math.max(10, width * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const a1 = angle + Math.PI * 0.85, a2 = angle - Math.PI * 0.85;
  return `M${x2} ${y2}L${x2 + len * Math.cos(a1)} ${y2 + len * Math.sin(a1)}L${x2 + len * Math.cos(a2)} ${y2 + len * Math.sin(a2)}Z`;
}

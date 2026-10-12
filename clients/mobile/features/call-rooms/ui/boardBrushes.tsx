import React from 'react';
import { G, Path } from 'react-native-svg';
import type { Brush, Stroke } from '../board';
import { pathFor } from '../board';

/**
 * How each brush looks. Every stroke is a list of points; the brush decides how those points are painted. Brushes are drawn from
 * the same points on every phone, so everyone sees the same picture.
 */

export const BRUSH_LABELS: Record<Brush, string> = {
  pen: 'Pen',
  'calligraphy-brush': 'Calligraphy brush',
  'calligraphy-pen': 'Calligraphy pen',
  airbrush: 'Airbrush',
  crayon: 'Crayon',
  oil: 'Oil brush',
  marker: 'Marker',
  'natural-pencil': 'Natural pencil',
};

/** A slanted nib: each step of the line is a small slab, thick across the nib's angle and thin along it. */
function nibPath(points: number[], w: number, h: number, half: number, angleDeg: number, vary: boolean): string {
  const a = (angleDeg * Math.PI) / 180;
  const nx = Math.cos(a);
  const ny = -Math.sin(a);
  if (points.length < 4) {
    const x = (points[0] ?? 0) * w;
    const y = (points[1] ?? 0) * h;
    return `M${x - nx * half} ${y - ny * half}L${x + nx * half} ${y + ny * half}L${x + nx * half + 0.6} ${y + ny * half}Z`;
  }
  let d = '';
  for (let i = 0; i + 3 < points.length; i += 2) {
    const px = points[i] * w, py = points[i + 1] * h, qx = points[i + 2] * w, qy = points[i + 3] * h;
    // A brush thins out when it moves fast and fattens when it slows down.
    const len = Math.hypot(qx - px, qy - py);
    const f = vary ? Math.min(1.25, Math.max(0.45, 1.3 - len / (half * 5))) : 1;
    const ox = nx * half * f;
    const oy = ny * half * f;
    d += `M${(px - ox).toFixed(1)} ${(py - oy).toFixed(1)}L${(px + ox).toFixed(1)} ${(py + oy).toFixed(1)}L${(qx + ox).toFixed(1)} ${(qy + oy).toFixed(1)}L${(qx - ox).toFixed(1)} ${(qy - oy).toFixed(1)}Z`;
  }
  return d;
}

export function StrokeShape({ k, w, h }: { k: Stroke; w: number; h: number }) {
  const px = Math.max(1, k.width * w);
  const d = pathFor(k.points, w, h);
  if (!d) return null;
  const round = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  switch (k.brush) {
    case 'marker':
      return <Path d={d} stroke={k.color} strokeWidth={px * 2.4} strokeOpacity={0.5} strokeLinecap="square" strokeLinejoin="round" fill="none" />;
    case 'airbrush':
      return (
        <G>
          <Path d={d} stroke={k.color} strokeWidth={px * 4} strokeOpacity={0.07} {...round} />
          <Path d={d} stroke={k.color} strokeWidth={px * 2.8} strokeOpacity={0.12} {...round} />
          <Path d={d} stroke={k.color} strokeWidth={px * 1.7} strokeOpacity={0.2} {...round} />
          <Path d={d} stroke={k.color} strokeWidth={px * 0.8} strokeOpacity={0.3} {...round} />
        </G>
      );
    case 'crayon':
      return (
        <G>
          <Path d={d} stroke={k.color} strokeWidth={px * 1.6} strokeOpacity={0.85} strokeDasharray={`${px * 0.9},${px * 0.35}`} strokeLinecap="butt" strokeLinejoin="round" fill="none" />
          <Path d={d} stroke={k.color} strokeWidth={px * 1.3} strokeOpacity={0.55} strokeDasharray={`${px * 0.5},${px * 0.7}`} strokeDashoffset={px * 0.4} strokeLinecap="butt" strokeLinejoin="round" fill="none" transform={`translate(${px * 0.2} ${px * 0.25})`} />
        </G>
      );
    case 'oil':
      return (
        <G>
          <Path d={d} stroke={k.color} strokeWidth={px * 0.9} strokeOpacity={0.55} {...round} transform={`translate(0 ${-px * 0.7})`} />
          <Path d={d} stroke={k.color} strokeWidth={px * 1.1} strokeOpacity={0.95} {...round} />
          <Path d={d} stroke={k.color} strokeWidth={px * 0.9} strokeOpacity={0.6} {...round} transform={`translate(${px * 0.15} ${px * 0.7})`} />
          <Path d={d} stroke="#FFFFFF" strokeWidth={px * 0.25} strokeOpacity={0.18} {...round} transform={`translate(0 ${-px * 0.3})`} />
        </G>
      );
    case 'natural-pencil':
      return (
        <G>
          <Path d={d} stroke={k.color} strokeWidth={Math.max(1, px * 0.55)} strokeOpacity={0.9} {...round} />
          <Path d={d} stroke={k.color} strokeWidth={Math.max(0.8, px * 0.35)} strokeOpacity={0.45} {...round} transform="translate(0.5 0.4)" />
        </G>
      );
    case 'calligraphy-pen':
      return <Path d={nibPath(k.points, w, h, px * 1.1, 45, false)} fill={k.color} stroke={k.color} strokeWidth={0.6} strokeLinejoin="round" />;
    case 'calligraphy-brush':
      return <Path d={nibPath(k.points, w, h, px * 1.2, 30, true)} fill={k.color} stroke={k.color} strokeWidth={0.6} strokeLinejoin="round" />;
    default:
      return <Path d={d} stroke={k.color} strokeWidth={px} {...round} />;
  }
}

/** A small preview of a brush for the picker. */
export function BrushSample({ brush, color }: { brush: Brush; color: string }) {
  const stroke: Stroke = { id: 'sample', author: '', color, width: 0.016, done: true, brush, points: [0.08, 0.7, 0.28, 0.25, 0.5, 0.65, 0.72, 0.28, 0.92, 0.6] };
  return <StrokeShape k={stroke} w={72} h={28} />;
}

import { memo, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo } from "react-native";
import Svg, { Path } from "react-native-svg";
import { GLOBE_DOTS } from "../services/globe-dots";

/** How far the spin axis leans from straight up, in degrees (Earth's own lean is 23.5). */
export const GLOBE_AXIS_TILT_DEG = 23.5;
/** Seconds for one full turn: slow and calm. */
const SECONDS_PER_TURN = 75;
const FRAME_MS = 66;

const RAD = Math.PI / 180;
const VIEW = 380;
const R = 190;
const DOT = 4.4;
const rollSin = Math.sin(GLOBE_AXIS_TILT_DEG * RAD);
const rollCos = Math.cos(GLOBE_AXIS_TILT_DEG * RAD);
const BANDS = [
  { min: 0.55, opacity: 0.96 },
  { min: 0.28, opacity: 0.78 },
  { min: 0.0, opacity: 0.5 }
] as const;

type Dot = { sinLat: number; cosLat: number; lon: number };

/**
 * The dots of the original welcome map, wrapped onto a sphere so that at rest it looks exactly like the picture. The far side
 * carries the same map again, half a turn round, so the globe is never empty as it spins.
 */
function dots(): Dot[] {
  const out: Dot[] = [];
  for (let i = 0; i < GLOBE_DOTS.length; i += 2) {
    const lat = GLOBE_DOTS[i]! * RAD, lon = GLOBE_DOTS[i + 1]! * RAD;
    const base = { sinLat: Math.sin(lat), cosLat: Math.cos(lat) };
    out.push({ ...base, lon }, { ...base, lon: lon + Math.PI });
  }
  return out;
}

/** One path per brightness band: each dot is a zero-length round-capped segment, so every dot stays a crisp circle. */
function projectDots(all: Dot[], spin: number): string[] {
  const paths = BANDS.map(() => "");
  for (const d of all) {
    const a = d.lon + spin; // west to east: the near side travels left to right
    const z = d.cosLat * Math.cos(a);
    if (z <= 0) continue;
    const x = d.cosLat * Math.sin(a);
    const y = d.sinLat;
    const sx = VIEW / 2 + (x * rollCos + y * rollSin) * R;
    const sy = VIEW / 2 - (y * rollCos - x * rollSin) * R;
    const band = BANDS.findIndex((b) => z >= b.min);
    paths[band] += `M${sx.toFixed(1)} ${sy.toFixed(1)}h0`;
  }
  return paths;
}

function SpinningGlobeComponent({ size }: { size: number }) {
  const all = useMemo(dots, []);
  const [spin, setSpin] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduceMotion(v)).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { alive = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const start = Date.now();
    const timer = setInterval(() => setSpin((((Date.now() - start) / 1000) / SECONDS_PER_TURN) * Math.PI * 2), FRAME_MS);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  const paths = useMemo(() => projectDots(all, spin), [all, spin]);
  return (
    <Svg accessible={false} width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
      {BANDS.map((b, i) => (
        <Path key={i} d={paths[i]} stroke="#EEE9FF" strokeOpacity={b.opacity} strokeWidth={DOT} strokeLinecap="round" fill="none" />
      )).reverse()}
    </Svg>
  );
}

export const SpinningGlobe = memo(SpinningGlobeComponent);

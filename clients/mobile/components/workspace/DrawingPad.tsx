import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import { MAX_DRAWING_CHARS, pointsToPath, strokeChars, type Stroke } from "../../services/workspace-model";
import { fonts } from "../../theme/tokens";
import { M } from "./module-ui";

/** Strokes live in a fixed 1000 x 1000 space, so a drawing looks the same on every screen and in the list thumbnail. */
export const CANVAS = 1000;
const COLORS = ["#FFFFFF", "#1677FF", "#F5A524", "#22C55E", "#FF6B9A"] as const;
const WIDTHS = [{ label: "Thin", value: 5 }, { label: "Thick", value: 14 }] as const;

export function DrawingThumb({ strokes, size = 56 }: { strokes: Stroke[]; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${CANVAS} ${CANVAS}`}>
      {strokes.map((s, i) => <Path key={i} d={s.d} stroke={s.color} strokeWidth={Math.max(s.width, 14)} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
    </Svg>
  );
}

/**
 * A finger drawing pad. Each stroke is saved as path text inside the encrypted note. `onTouching` tells the parent to stop
 * scrolling while a finger is down, so drawing doesn't scroll the page.
 */
export function DrawingPad({ strokes, onChange, onTouching, onTooMuch }: { strokes: Stroke[]; onChange: (next: Stroke[]) => void; onTouching: (down: boolean) => void; onTooMuch: () => void }) {
  const [side, setSide] = useState(0);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [width, setWidth] = useState<number>(WIDTHS[0].value);
  const [live, setLive] = useState<Array<{ x: number; y: number }>>([]);
  const points = useRef<Array<{ x: number; y: number }>>([]);
  const latest = useRef({ strokes, color, width, side });
  latest.current = { strokes, color, width, side };

  const pan = useMemo(() => {
    const at = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
      const { side: w } = latest.current;
      return { x: Math.min(CANVAS, Math.max(0, (e.nativeEvent.locationX / (w || 1)) * CANVAS)), y: Math.min(CANVAS, Math.max(0, (e.nativeEvent.locationY / (w || 1)) * CANVAS)) };
    };
    const finish = () => {
      const { strokes: all, color: c, width: wd } = latest.current;
      const d = pointsToPath(points.current, 2);
      points.current = []; setLive([]); onTouching(false);
      if (!d) return;
      const next = [...all, { color: c, width: wd, d }];
      if (strokeChars(next) > MAX_DRAWING_CHARS) { onTooMuch(); return; }
      onChange(next);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { onTouching(true); points.current = [at(e)]; setLive([...points.current]); },
      onPanResponderMove: (e) => { points.current.push(at(e)); setLive([...points.current]); },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish
    });
  }, [onChange, onTouching, onTooMuch]);

  const livePath = live.length ? pointsToPath(live, 2) : "";
  return (
    <View style={s.wrap}>
      <View accessible accessibilityLabel="Drawing area. Draw with your finger." style={[s.canvas, side ? { height: side } : { aspectRatio: 1 }]} onLayout={(e) => setSide(e.nativeEvent.layout.width)} {...pan.panHandlers}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${CANVAS} ${CANVAS}`} pointerEvents="none">
          {strokes.map((st, i) => <Path key={i} d={st.d} stroke={st.color} strokeWidth={st.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {livePath ? <Path d={livePath} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
        </Svg>
      </View>
      <View style={s.tools}>
        {COLORS.map((c) => (
          <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Pen colour ${c}`} accessibilityState={{ selected: color === c }} onPress={() => setColor(c)} style={[s.swatch, { backgroundColor: c }, color === c && s.swatchOn]} />
        ))}
        <View style={{ flex: 1 }} />
        {WIDTHS.map((w) => (
          <Pressable key={w.label} accessibilityRole="button" accessibilityState={{ selected: width === w.value }} onPress={() => setWidth(w.value)} style={[s.tool, width === w.value && { borderColor: M.accent }]}>
            <Text style={s.toolText}>{w.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.tools}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !strokes.length }} disabled={!strokes.length} onPress={() => onChange(strokes.slice(0, -1))} style={[s.tool, !strokes.length && { opacity: 0.4 }]}>
          <Ionicons name="arrow-undo" size={14} color={M.text} /><Text style={s.toolText}>Undo</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !strokes.length }} disabled={!strokes.length} onPress={() => onChange([])} style={[s.tool, !strokes.length && { opacity: 0.4 }]}>
          <Ionicons name="trash-outline" size={14} color={M.danger} /><Text style={[s.toolText, { color: M.danger }]}>Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  canvas: { width: "100%", backgroundColor: "#06223A", borderWidth: 1, borderColor: M.border, borderRadius: 14, overflow: "hidden" },
  tools: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "transparent" },
  swatchOn: { borderColor: M.accent, transform: [{ scale: 1.12 }] },
  tool: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: M.border, backgroundColor: M.card, borderRadius: 999, paddingHorizontal: 12, minHeight: 30 },
  toolText: { fontFamily: fonts.semibold, fontSize: 12, color: M.text }
});

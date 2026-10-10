// Tools, colors, widths, undo/redo and zoom controls for the whiteboard.

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Style, Tool } from "./WhiteboardCanvas";
import { inkColors, palette as c, space, stickyColors } from "../ui/tokens";

const TOOLS: { tool: Tool; label: string; d: string }[] = [
  { tool: "select", label: "Select", d: "M5 3l14 8-6 2-2 6z" },
  { tool: "hand", label: "Move around", d: "M8 13V6a1.5 1.5 0 0 1 3 0v6 M11 11V4.5a1.5 1.5 0 0 1 3 0V11 M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7s-5-2-7-5l-1.5-2.5a1.5 1.5 0 0 1 2.5-1.5L8 13" },
  { tool: "pen", label: "Pen", d: "M4 20l4-1 11-11-3-3L5 16z" },
  { tool: "highlighter", label: "Highlighter", d: "M9 15l-4 4h6l1-1 M9 15l7-11 4 3-7 11z" },
  { tool: "eraser", label: "Eraser", d: "M8 20h12 M5 16l9-11 6 5-8 10H9z" },
  { tool: "rect", label: "Rectangle", d: "M4 6h16v12H4z" },
  { tool: "ellipse", label: "Circle", d: "M12 19c4.4 0 8-3.1 8-7s-3.6-7-8-7-8 3.1-8 7 3.6 7 8 7z" },
  { tool: "line", label: "Line", d: "M5 19L19 5" },
  { tool: "arrow", label: "Arrow", d: "M5 19L19 5 M10 5h9v9" },
  { tool: "text", label: "Text", d: "M5 6V4h14v2 M12 4v16 M9 20h6" },
  { tool: "sticky", label: "Sticky note", d: "M4 4h16v10l-6 6H4z M14 20v-6h6" },
  { tool: "laser", label: "Laser pointer", d: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M12 2v4 M12 18v4 M2 12h4 M18 12h4" },
];

const WIDTHS = [2, 4, 8];

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  style: Style;
  onStyle: (s: Style) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasSelection: boolean;
  onDeleteSelection: () => void;
  onRecolorSelection: (color: string) => void;
  /** Hidden when someone else is presenting and has locked the board. */
  locked?: boolean;
  /** Fewer tools when annotating over a shared screen. */
  compact?: boolean;
}

export function WhiteboardToolbar(p: Props) {
  const tools = p.compact ? TOOLS.filter((t) => ["select", "pen", "highlighter", "eraser", "arrow", "rect", "laser"].includes(t.tool)) : TOOLS;
  const colors = p.tool === "sticky" ? stickyColors : inkColors;
  const activeColor = p.tool === "sticky" ? p.style.stickyColor : p.style.color;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <IconBtn label="Undo" d="M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3" onPress={p.onUndo} disabled={!p.canUndo || p.locked} />
        <IconBtn label="Redo" d="M15 14l5-5-5-5 M20 9H9a5 5 0 0 0 0 10h3" onPress={p.onRedo} disabled={!p.canRedo || p.locked} />
        <View style={styles.spacer} />
        <IconBtn label="Zoom out" d="M5 12h14" onPress={p.onZoomOut} />
        <Pressable onPress={p.onFit} accessibilityRole="button" accessibilityLabel="Fit board to screen" style={styles.zoomPct}>
          <Text style={styles.zoomText}>{Math.round(p.zoom * 100)}%</Text>
        </Pressable>
        <IconBtn label="Zoom in" d="M12 5v14 M5 12h14" onPress={p.onZoomIn} />
      </View>

      {p.locked ? (
        <Text style={styles.lockedNote}>The presenter turned off drawing for others. You can still use the laser pointer.</Text>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>
            {tools.map((t) => (
              <IconBtn key={t.tool} label={t.label} d={t.d} on={p.tool === t.tool} onPress={() => p.onTool(t.tool)} />
            ))}
          </ScrollView>

          <View style={styles.row}>
            {colors.map((col) => (
              <Pressable
                key={col}
                onPress={() =>
                  p.hasSelection
                    ? p.onRecolorSelection(col)
                    : p.onStyle(p.tool === "sticky" ? { ...p.style, stickyColor: col } : { ...p.style, color: col })
                }
                accessibilityRole="button"
                accessibilityLabel={`Color ${col}`}
                accessibilityState={{ selected: activeColor === col }}
                style={[styles.swatchHit]}
              >
                <View style={[styles.swatch, { backgroundColor: col }, activeColor === col && styles.swatchOn, col === "#FFFFFF" && styles.swatchWhite]} />
              </Pressable>
            ))}
          </View>

          <View style={styles.row}>
            {WIDTHS.map((w) => (
              <Pressable
                key={w}
                onPress={() => p.onStyle({ ...p.style, width: w })}
                accessibilityRole="button"
                accessibilityLabel={`Line width ${w}`}
                accessibilityState={{ selected: p.style.width === w }}
                style={[styles.widthBtn, p.style.width === w && styles.widthOn]}
              >
                <View style={{ width: 22, height: w, borderRadius: w, backgroundColor: c.ink }} />
              </Pressable>
            ))}
            {p.tool === "rect" || p.tool === "ellipse" ? (
              <Pressable onPress={() => p.onStyle({ ...p.style, fill: !p.style.fill })} accessibilityRole="switch" accessibilityState={{ checked: p.style.fill }} style={[styles.widthBtn, p.style.fill && styles.widthOn]}>
                <Text style={styles.small}>Fill</Text>
              </Pressable>
            ) : null}
            <View style={styles.spacer} />
            {p.hasSelection ? (
              <Pressable onPress={p.onDeleteSelection} accessibilityRole="button" style={styles.deleteBtn}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

function IconBtn({ label, d, onPress, on, disabled }: { label: string; d: string; onPress: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!on, disabled: !!disabled }}
      style={[styles.icon, on && styles.iconOn, disabled && { opacity: 0.35 }]}
    >
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={on ? "#fff" : c.ink} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <Path d={d} />
      </Svg>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: c.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, paddingTop: space.s, paddingBottom: 30, gap: space.s },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.m, gap: space.xs },
  tools: { paddingHorizontal: space.m, gap: space.xs },
  spacer: { flex: 1 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  iconOn: { backgroundColor: c.outgoing },
  zoomPct: { minWidth: 56, height: 44, alignItems: "center", justifyContent: "center" },
  zoomText: { fontSize: 13, fontWeight: "600", color: c.ink },
  swatchHit: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  swatchOn: { borderWidth: 3, borderColor: c.secure, width: 32, height: 32, borderRadius: 16 },
  swatchWhite: { borderWidth: 1, borderColor: c.line },
  widthBtn: { height: 40, minWidth: 48, paddingHorizontal: 10, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: c.line },
  widthOn: { borderColor: c.secure, backgroundColor: c.secureTint },
  small: { fontSize: 13, fontWeight: "600", color: c.ink },
  deleteBtn: { height: 40, paddingHorizontal: 14, borderRadius: 10, justifyContent: "center", backgroundColor: "#FBEAEA" },
  deleteText: { color: c.danger, fontWeight: "600", fontSize: 14 },
  lockedNote: { paddingHorizontal: space.l, fontSize: 13, color: c.muted },
});

import { memo, useMemo } from "react";
import { StyleSheet, View } from "react-native";

const LOGICAL_SIZE = 320;
const STEP = 10;
const RADIUS = 151;

function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number) {
  return ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) <= 1;
}

function isLand(x: number, y: number) {
  return (
    ellipse(x, y, -0.54, -0.30, 0.31, 0.26) ||
    ellipse(x, y, -0.70, -0.03, 0.20, 0.21) ||
    ellipse(x, y, -0.34, 0.29, 0.19, 0.41) ||
    ellipse(x, y, 0.03, -0.28, 0.20, 0.13) ||
    ellipse(x, y, 0.10, 0.08, 0.23, 0.39) ||
    ellipse(x, y, 0.42, -0.24, 0.42, 0.25) ||
    ellipse(x, y, 0.61, 0.03, 0.24, 0.22) ||
    ellipse(x, y, 0.59, 0.48, 0.18, 0.13) ||
    ellipse(x, y, 0.27, 0.52, 0.05, 0.11)
  );
}

function DottedGlobeComponent({ size }: { size: number }) {
  const scale = size / LOGICAL_SIZE;
  const dots = useMemo(() => {
    const result: Array<{ x: number; y: number; land: boolean }> = [];
    for (let y = STEP; y < LOGICAL_SIZE; y += STEP) {
      for (let x = STEP; x < LOGICAL_SIZE; x += STEP) {
        const dx = x - LOGICAL_SIZE / 2;
        const dy = y - LOGICAL_SIZE / 2;
        if (dx * dx + dy * dy > RADIUS * RADIUS) continue;
        const nx = dx / RADIUS;
        const ny = dy / RADIUS;
        result.push({ x, y, land: isLand(nx, ny) });
      }
    }
    return result;
  }, []);

  return (
    <View accessible={false} style={[styles.globe, { width: size, height: size, borderRadius: size / 2 }]}>
      <View style={[styles.halo, { borderRadius: size / 2 }]} />
      {dots.map((dot, index) => {
        const diameter = (dot.land ? 5.4 : 2.4) * scale;
        return (
          <View
            key={index}
            style={{
              position: "absolute",
              left: dot.x * scale - diameter / 2,
              top: dot.y * scale - diameter / 2,
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              backgroundColor: dot.land ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.12)"
            }}
          />
        );
      })}
    </View>
  );
}

export const DottedGlobe = memo(DottedGlobeComponent);

const styles = StyleSheet.create({
  globe: { overflow: "hidden", alignSelf: "center" },
  halo: { position: "absolute", inset: 0, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }
});

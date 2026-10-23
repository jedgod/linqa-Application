import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { G, Path, Rect, Text as SvgText } from "react-native-svg";
import { qrMatrix, qrPath } from "../../services/wallet-stealthpay";

const QUIET = 2; // modules of white border around the code, as scanners expect
const INK = "#0B1B2B";
const TEAL = "#0FB8AB";
// A unit shield, drawn at (0,0) and scaled into place.
const SHIELD = "M0 -1 L0.8 -0.7 L0.8 0.1 Q0.8 0.7 0 1 Q-0.8 0.7 -0.8 0.1 L-0.8 -0.7 Z";

/**
 * A scannable QR for `payload`, drawn as one SVG path, with the Linqa mark in the middle. The mark is painted inside the
 * same SVG (not layered on top as a separate view), and covers about 5% of the code, well within its high error correction.
 */
export function QrCode({ payload, size = 168 }: { payload: string; size?: number }) {
  const { path, modules } = useMemo(() => { const matrix = qrMatrix(payload); return { path: qrPath(matrix), modules: matrix.length }; }, [payload]);
  const span = modules + QUIET * 2;
  const mid = modules / 2;
  const w = modules * 0.3, h = modules * 0.22;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Invoice QR code" style={[s.box, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`${-QUIET} ${-QUIET} ${span} ${span}`}>
        <Path d={path} fill={INK} />
        <Rect x={mid - w / 2} y={mid - h / 2} width={w} height={h} rx={1.2} fill="#FFFFFF" />
        <G transform={`translate(${mid} ${mid - h * 0.17}) scale(${h * 0.26})`}><Path d={SHIELD} fill={TEAL} /></G>
        <SvgText x={mid} y={mid + h * 0.36} fontSize={h * 0.3} fontWeight="bold" fill={TEAL} textAnchor="middle">Linqa</SvgText>
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: "#FFFFFF", borderRadius: 10, overflow: "hidden" }
});

import { StyleSheet, Text, View } from "react-native";
import { fonts } from "../../theme/tokens";
import { send } from "./ui";

const SIZE = 210;
const STROKE = 15;
const RADIUS = (SIZE - STROKE) / 2;
const SEGMENTS = 96;
const SEGMENT_WIDTH = (2 * Math.PI * RADIUS) / SEGMENTS - 1.6;
const USED = "#4F3FE0";
const REMAINING = "#B8E6D5";

/**
 * Ring showing how much of a limit is used, drawn from small bars so it needs no native graphics
 * module (the installed build cannot draw react-native-svg shapes). Starts at 12 o'clock and runs
 * clockwise. With no limit (share null) it is a plain grey ring.
 */
export function LimitsGauge({ share, centerTop, centerBottom }: { share: number | null; centerTop: string; centerBottom: string }) {
  const filled = share === null ? 0 : Math.round(Math.min(1, Math.max(0, share)) * SEGMENTS);
  // A real but tiny usage should still be visible.
  const lit = share !== null && share > 0 ? Math.max(1, filled) : 0;
  return (
    <View style={s.gauge} accessible accessibilityLabel={`${centerTop} ${centerBottom}`}>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <View
          key={i}
          style={[
            s.segment,
            {
              backgroundColor: share === null ? send.border : i < lit ? USED : REMAINING,
              transform: [{ rotate: `${(i * 360) / SEGMENTS}deg` }, { translateY: -RADIUS }]
            }
          ]}
        />
      ))}
      <View style={s.center} pointerEvents="none">
        <Text style={s.top}>{centerTop}</Text>
        <Text style={s.bottom}>{centerBottom}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  gauge: { alignSelf: "center", width: SIZE, height: SIZE, marginVertical: 22, alignItems: "center", justifyContent: "center" },
  segment: { position: "absolute", left: SIZE / 2 - SEGMENT_WIDTH / 2, top: SIZE / 2 - STROKE / 2, width: SEGMENT_WIDTH, height: STROKE, borderRadius: 2 },
  center: { alignItems: "center", paddingHorizontal: 26 },
  top: { color: send.text, fontFamily: fonts.extrabold, fontSize: 26 },
  bottom: { color: send.muted, fontFamily: fonts.medium, fontSize: 14, marginTop: 4, textAlign: "center" }
});

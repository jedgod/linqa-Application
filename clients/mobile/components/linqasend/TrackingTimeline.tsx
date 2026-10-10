import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../theme/tokens";
import type { StepState, TrackingStep } from "../../services/transfer-tracking";
import { send } from "./ui";

const GREEN = "#12A150";

export function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === new Date(now.getTime() - 86_400_000).toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function Dot({ state }: { state: StepState }) {
  if (state === "done") return <View style={[s.dot, { backgroundColor: GREEN }]}><Ionicons name="checkmark" size={18} color="#FFFFFF" /></View>;
  if (state === "failed") return <View style={[s.dot, { backgroundColor: send.danger }]}><Ionicons name="close" size={18} color="#FFFFFF" /></View>;
  if (state === "current") return <View style={s.halo}><View style={[s.dot, s.dotCurrent]} /></View>;
  return <View style={[s.dot, s.dotPending]} />;
}


export function TrackingTimeline({ steps }: { steps: TrackingStep[] }) {
  return (
    <View style={s.timeline} accessibilityRole="list">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const nextDone = steps[index + 1]?.state !== "pending" && step.state === "done";
        const when = whenLabel(step.at);
        return (
          <View key={step.key} style={s.stepRow} accessible accessibilityLabel={`${step.label}, ${step.state === "done" ? "completed" : step.state === "current" ? "in progress" : step.state === "failed" ? "stopped" : "not yet"}${when ? `, ${when}` : ""}`}>
            <View style={s.rail}>
              <Dot state={step.state} />
              {!last ? <View style={[s.line, { backgroundColor: nextDone ? GREEN : send.border }]} /> : null}
            </View>
            <View style={s.stepText}>
              <Text style={[s.stepLabel, step.state === "pending" && { color: send.muted }, step.state === "failed" && { color: send.danger }]}>{step.label}</Text>
              {when ? <Text style={s.stepTime}>{when}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  timeline: { paddingLeft: 10 },
  stepRow: { flexDirection: "row", minHeight: 86 },
  rail: { width: 48, alignItems: "center" },
  line: { width: 3, flex: 1, marginTop: 2, borderRadius: 2 },
  stepText: { flex: 1, paddingLeft: 14, paddingTop: 5 },
  stepLabel: { color: send.text, fontFamily: fonts.semibold, fontSize: 17 },
  stepTime: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 5 },
  dot: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  dotCurrent: { backgroundColor: send.bg, borderWidth: 3, borderColor: "#2F4CC4" },
  dotPending: { backgroundColor: send.bg, borderWidth: 2.5, borderColor: send.border },
  halo: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#DCEFE8", alignItems: "center", justifyContent: "center", marginVertical: -6 }
});

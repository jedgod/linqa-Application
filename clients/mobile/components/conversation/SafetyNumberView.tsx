import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Theme } from "../../services/conversation-engine";
import { radius, space, type } from "./theme";
import { SubHeader } from "./SubHeader";

interface Props {
  theme: Theme;
  peerName: string;
  peerFirstName: string;
  /** Twelve groups of five digits derived by the secure core for this pair of people, or null when it cannot be derived. */
  numbers: string[] | null;
  verified: boolean;
  onMarkVerified: () => void;
  onBack: () => void;
}

/**
 * Verify <person>: the safety number both phones should show. The number is only ever the real one from the secure core;
 * when it is not available this page says so and offers nothing to confirm, rather than showing placeholder digits.
 */
export function SafetyNumberView({ theme: t, peerName, peerFirstName, numbers, verified, onMarkVerified, onBack }: Props) {
  const rows = numbers && numbers.length === 12 ? [0, 3, 6, 9].map((i) => numbers.slice(i, i + 3)) : null;
  return (
    <View style={[styles.fill, { backgroundColor: t.surface }]}>
      <SubHeader theme={t} title={`Verify ${peerName}`} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.body, { color: t.muted }]}>Compare these numbers with {peerFirstName} in person or on a call.</Text>
        <Text style={[type.body, { color: t.muted, marginTop: space.xs }]}>If they match on both phones, no one else can read your messages.</Text>

        {rows ? (
          <View style={[styles.grid, { backgroundColor: t.background }]} accessibilityLabel={`Safety number: ${numbers!.join(" ")}`}>
            {rows.map((row, i) => (
              <View key={i} style={[styles.gridRow, i > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                {row.map((group, j) => <Text key={j} style={[styles.digits, { color: t.ink }]}>{group}</Text>)}
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.unavailable, { backgroundColor: t.warnSurface }]}>
            <Text style={[type.body, { color: "#302342", fontWeight: "600" }]}>Safety number not available</Text>
            <Text style={[type.meta, { color: "#302342", marginTop: 2 }]}>This device can't work it out until secure messaging is available. Nothing is shown here instead, so there is nothing to compare by mistake.</Text>
          </View>
        )}

        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !rows || verified }} disabled={!rows || verified} onPress={onMarkVerified} style={[styles.primary, { backgroundColor: rows && !verified ? t.accent : t.line }]}>
          <Text style={[type.title, { color: rows && !verified ? t.onAccent : t.muted }]}>{verified ? "Verified" : "Mark as verified"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} disabled style={[styles.secondary, { borderColor: t.line }]}>
          <Text style={[type.title, { color: t.muted }]}>Scan {peerFirstName}'s code</Text>
        </Pressable>
        <Text style={[type.meta, { color: t.muted, textAlign: "center" }]}>Scanning a code isn't available in this version.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.l, gap: space.m },
  grid: { borderRadius: radius.bubble, marginTop: space.s },
  gridRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.xl, paddingVertical: space.l },
  digits: { fontSize: 24, fontWeight: "500", letterSpacing: 1, fontVariant: ["tabular-nums"] },
  unavailable: { borderRadius: radius.bubble, padding: space.l, marginTop: space.s },
  primary: { minHeight: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: space.s },
  secondary: { minHeight: 54, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" }
});

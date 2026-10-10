import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Theme } from "../../services/conversation-engine";
import { space, type } from "./theme";

/** Header for the pages opened from a conversation (Decisions, Verify, Settings): back, a title and an optional line under it. */
export function SubHeader({ theme: t, title, subtitle, centered, onBack }: { theme: Theme; title: string; subtitle?: string; centered?: boolean; onBack: () => void }) {
  return (
    <View style={[styles.bar, { backgroundColor: t.surface, borderBottomColor: t.line }]}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={styles.back}>
        <Text style={[styles.glyph, { color: t.ink }]}>‹</Text>
      </Pressable>
      <View style={[styles.titles, centered && { alignItems: "center", marginRight: 36 }]}>
        <Text accessibilityRole="header" style={[type.title, { color: t.ink, fontSize: 19 }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[type.meta, { color: t.muted }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.s, paddingVertical: space.m, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 30, lineHeight: 32 },
  titles: { flex: 1, minWidth: 0, marginLeft: space.xs }
});

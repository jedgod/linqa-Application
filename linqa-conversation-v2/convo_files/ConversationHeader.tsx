import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ConversationPeer, GateState } from "./types";
import { ConversationTheme, space, type } from "./theme";

interface Props {
  peer: ConversationPeer;
  gate: GateState;
  theme: ConversationTheme;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenDecisions?: () => void;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function statusFor(gate: GateState, t: ConversationTheme) {
  switch (gate.mode) {
    case "LIVE":
      return { label: "End-to-end encrypted", color: t.secure };
    case "CHECKING":
      return { label: "Checking encryption", color: t.sealed };
    case "LOCKED":
      return { label: "Messages sealed on this device", color: t.warn };
  }
}

export function ConversationHeader({ peer, gate, theme: t, onBack, onOpenSettings, onOpenDecisions }: Props) {
  const status = statusFor(gate, t);
  const decisionsEnabled = gate.mode === "LIVE" && Boolean(onOpenDecisions);

  return (
    <View style={[styles.bar, { backgroundColor: t.surface, borderBottomColor: t.line }]}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={styles.icon}>
        <Text style={[styles.glyph, { color: t.ink }]}>‹</Text>
      </Pressable>

      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel={`${peer.displayName}, ${status.label}. Open conversation settings`}
        style={styles.identity}
      >
        <View style={[styles.avatar, { backgroundColor: t.bg, borderColor: status.color }]}>
          <Text style={[styles.avatarText, { color: t.ink }]}>{initials(peer.displayName)}</Text>
        </View>
        <View style={styles.names}>
          <Text style={[type.title, { color: t.ink }]} numberOfLines={1}>
            {peer.displayName}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: status.color }]} />
            <Text style={[type.meta, { color: t.inkMuted }]} numberOfLines={1}>
              {status.label}
            </Text>
          </View>
        </View>
      </Pressable>

      {onOpenDecisions ? (
        <Pressable
          onPress={onOpenDecisions}
          disabled={!decisionsEnabled}
          accessibilityRole="button"
          accessibilityLabel="Decisions"
          accessibilityState={{ disabled: !decisionsEnabled }}
          style={[styles.textButton, { opacity: decisionsEnabled ? 1 : 0.4 }]}
        >
          <Text style={[type.meta, { color: t.secure, fontWeight: "600" }]}>Decisions</Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Conversation settings"
        hitSlop={12}
        style={styles.icon}
      >
        <Text style={[styles.glyph, { color: t.ink }]}>⋯</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.s,
    paddingVertical: space.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 26, lineHeight: 28 },
  identity: { flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: space.s,
  },
  avatarText: { fontSize: 14, fontWeight: "600" },
  names: { flex: 1, minWidth: 0 },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: space.xs + 2 },
  textButton: { paddingHorizontal: space.s, paddingVertical: space.xs },
});

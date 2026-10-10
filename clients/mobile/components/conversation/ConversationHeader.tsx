import React from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Theme } from "../../services/conversation-engine";
import type { ConversationPeer, GateState } from "../../services/conversation-types";
import { space, type } from "./theme";

interface Props {
  peer: ConversationPeer;
  gate: GateState;
  theme: Theme;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenDecisions?: () => void;
  onCall?: (kind: "AUDIO" | "VIDEO") => void;
  /** The person is blocked: no status of encryption, no Decisions. */
  blocked?: boolean;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

function statusFor(gate: GateState, t: Theme, blocked?: boolean) {
  if (blocked) return { label: "Blocked", color: t.sealed };
  switch (gate.mode) {
    case "LIVE": return { label: "End-to-end encrypted", color: t.secure };
    case "CHECKING": return { label: "Checking encryption", color: t.sealed };
    case "LOCKED": return { label: "Messages sealed", color: t.warn };
  }
}

export function ConversationHeader({ peer, gate, theme: t, onBack, onOpenSettings, onCall, blocked }: Props) {
  const status = statusFor(gate, t, blocked);
  const call = (kind: "AUDIO" | "VIDEO") => onCall ? onCall(kind) : Alert.alert("Call unavailable", "Calling is not connected in this preview.");
  return (
    <View style={[styles.bar, { backgroundColor: t.surface, borderBottomColor: t.line }]}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={styles.icon}>
        <Ionicons name="chevron-back" size={30} color={t.ink} />
      </Pressable>
      <Pressable onPress={onOpenSettings} accessibilityRole="button" accessibilityLabel={`${peer.displayName}, ${status.label}. Open conversation settings`} style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: t.background, borderColor: status.color }]}>
          <Text style={[styles.avatarText, { color: t.ink }]}>{initials(peer.displayName)}</Text>
        </View>
        <View style={styles.names}>
          <Text style={[type.title, { color: t.ink }]} numberOfLines={1}>{peer.displayName}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: status.color }]} />
            <Text style={[type.meta, { color: status.color, fontWeight: "500" }]} numberOfLines={1}>{status.label}</Text>
          </View>
        </View>
      </Pressable>
      {(["AUDIO", "VIDEO"] as const).map(kind => <Pressable key={kind} onPress={() => call(kind)} disabled={Boolean(blocked) || !peer.id} accessibilityRole="button" accessibilityLabel={`${kind === "AUDIO" ? "Audio" : "Video"} call ${peer.displayName}`} accessibilityState={{ disabled: Boolean(blocked) || !peer.id }} style={[styles.call, { opacity: blocked || !peer.id ? 0.4 : 1 }]}><Ionicons name={kind === "AUDIO" ? "call-outline" : "videocam-outline"} size={23} color="#FFFFFF" /></Pressable>)}
      <Pressable onPress={onOpenSettings} accessibilityRole="button" accessibilityLabel="Conversation settings" hitSlop={12} style={styles.icon}>
        <Ionicons name="ellipsis-vertical" size={26} color={t.accent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 32, height: 44, alignItems: "center", justifyContent: "center" },
  call: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#050505", alignItems: "center", justifyContent: "center", marginLeft: 6 },
  glyph: { fontSize: 26, lineHeight: 28 },
  identity: { flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginRight: 9 },
  avatarText: { fontSize: 18, fontWeight: "500" },
  names: { flex: 1, minWidth: 0 },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: space.xs + 2 },
  textButton: { paddingHorizontal: space.s, paddingVertical: space.xs }
});

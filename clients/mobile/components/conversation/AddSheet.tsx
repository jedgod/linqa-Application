import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Theme } from "../../services/conversation-engine";
import { ACTION_ICONS, enabledActions, unavailableReason, type ThreadAction } from "../../services/conversation-thread";
import { radius, space, type } from "./theme";

interface Props {
  visible: boolean;
  theme: Theme;
  /** The actions this conversation has switched on (Settings → Add features). */
  enabled: ThreadAction[];
  /** Whether an action that works can be used right now (messaging live, not blocked). */
  canUse: boolean;
  localActions?: ThreadAction[];
  onPick: (action: ThreadAction) => void;
  onClose: () => void;
}

/**
 * "Add to chat": the ✦ sheet next to the message box. An action that cannot run in this build is dimmed, and tapping it
 * says why; it is never presented as a working button.
 */
export function AddSheet({ visible, theme: t, enabled, canUse, localActions = [], onPick, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [why, setWhy] = useState<string | null>(null);
  const items = enabledActions(enabled);
  const close = () => { setWhy(null); onClose(); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Pressable accessibilityLabel="Close menu" style={styles.scrim} onPress={close}>
        <Pressable accessible={false} style={[styles.sheet, { backgroundColor: t.surface, paddingBottom: space.xl + Math.max(insets.bottom, 24) }]} onPress={() => undefined}>
          <View style={[styles.grabber, { backgroundColor: t.line }]} />
          <Text accessibilityRole="header" style={[type.title, { color: t.ink, marginBottom: space.m }]}>Add to chat</Text>
          {items.length === 0 ? <Text style={[type.body, { color: t.muted }]}>Everything is switched off. Turn features on in Conversation settings.</Text> : null}
          <View style={styles.grid}>
            {items.map((a) => {
              const local = localActions.includes(a.id);
              const reason = local ? null : unavailableReason(a.id);
              const works = local || (!reason && canUse);
              return (
                <Pressable
                  key={a.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.label}${reason ? ". Not available yet" : ""}`}
                  onPress={() => { if (works) { setWhy(null); onClose(); onPick(a.id); } else setWhy(reason ? `${a.label}: ${reason}` : `${a.label}: not available right now.`); }}
                  style={[styles.cell, { opacity: works ? 1 : 0.45 }]}
                >
                  <View style={[styles.icon, { backgroundColor: t.background }]}><Ionicons name={ACTION_ICONS[a.id] as keyof typeof Ionicons.glyphMap} size={24} color={works ? t.accent : t.muted} /></View>
                  <Text style={[type.meta, { color: t.ink, textAlign: "center" }]} numberOfLines={2}>{a.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {why ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[type.meta, styles.why, { color: t.ink, backgroundColor: t.warnSurface }]}>{why}</Text> : null}
          <Pressable accessibilityRole="button" onPress={close} style={styles.closeBtn}><Text style={[type.body, { color: t.muted }]}>Close</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.l },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: space.m },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "25%", alignItems: "center", gap: space.xs, marginBottom: space.l, paddingHorizontal: 2 },
  icon: { width: 56, height: 56, borderRadius: radius.bubble, alignItems: "center", justifyContent: "center" },
  why: { padding: space.m, borderRadius: 12, marginTop: space.xs },
  closeBtn: { alignItems: "center", minHeight: 44, justifyContent: "center", marginTop: space.s }
});

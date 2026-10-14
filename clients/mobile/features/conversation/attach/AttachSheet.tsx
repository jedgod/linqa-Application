// The "+" menu ("Share with …"). Shows only the features turned on for this chat in
// Conversation settings > Chat features.
//
// Look: a colour-coded tile per option (each with its own vivid colour), a Light / Dark switch,
// soft shadows, and a coloured border on the tile being pressed. Ported from the supplied web design.

import { BottomInsetSpacer, ModalSafe } from "../../../components/common/ModalSafe";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { FontAwesome5 } from "@expo/vector-icons";

export interface ChatFeatures {
  media: boolean;
  voice: boolean;
  location: boolean; // also covers contacts
  polls: boolean;
  meetings: boolean; // events and meetings
  screen: boolean;
  ai: boolean;
}

export const DEFAULT_FEATURES: ChatFeatures = { media: true, voice: true, location: true, polls: true, meetings: true, screen: true, ai: false };

export type AttachAction =
  | "photos" | "camera" | "protected" | "document" | "location" | "contact" | "poll"
  | "event" | "meeting" | "voice" | "video" | "screen" | "whiteboard" | "ai" | "design";

type IconName = React.ComponentProps<typeof FontAwesome5>["name"];

const TILES: { action: AttachAction; label: string; feature: keyof ChatFeatures; icon: IconName; color: string; warn?: boolean }[] = [
  { action: "photos", label: "Photos", feature: "media", icon: "image", color: "#d97706" },
  { action: "camera", label: "Camera", feature: "media", icon: "camera", color: "#ea580c" },
  { action: "protected", label: "Protected photo", feature: "media", icon: "lock", color: "#dc2626" },
  { action: "document", label: "Document", feature: "media", icon: "file-alt", color: "#2563eb" },
  { action: "design", label: "Design / crop", feature: "media", icon: "crop", color: "#0d9488" },
  { action: "location", label: "Location", feature: "location", icon: "map-marker-alt", color: "#16a34a" },
  { action: "contact", label: "Contact", feature: "location", icon: "user", color: "#9333ea" },
  { action: "poll", label: "Poll", feature: "polls", icon: "poll", color: "#4f46e5" },
  { action: "event", label: "Event", feature: "meetings", icon: "calendar-alt", color: "#db2777" },
  { action: "meeting", label: "Meeting", feature: "meetings", icon: "users", color: "#2563eb" },
  { action: "voice", label: "Voice", feature: "voice", icon: "microphone", color: "#f97316" },
  { action: "video", label: "Video clip", feature: "voice", icon: "video", color: "#8b5cf6" },
  { action: "screen", label: "Share screen", feature: "screen", icon: "desktop", color: "#10b981" },
  { action: "whiteboard", label: "Whiteboard", feature: "screen", icon: "chalkboard", color: "#2563eb" },
  { action: "ai", label: "AI image", feature: "ai", icon: "magic", color: "#d97706", warn: true },
];

const light = {
  surface: "#ffffff", textMain: "#111827", textMuted: "#6b7280", accent: "#4f46e5", border: "rgba(0,0,0,0.1)",
  option: "#f9fafb", shadow: "#000000", toggleBg: "#e0e7ff", toggleCircle: "#4f46e5", scrim: "rgba(17,24,39,0.45)",
};
const dark = {
  surface: "#1c2127", textMain: "#f9fafb", textMuted: "#9ca3af", accent: "#818cf8", border: "rgba(255,255,255,0.1)",
  option: "#252c34", shadow: "#000000", toggleBg: "#6366f1", toggleCircle: "#1c2127", scrim: "rgba(0,0,0,0.6)",
};

// Remembered for the rest of the session so the choice sticks between openings.
let rememberedDark = false;

interface Props {
  visible: boolean;
  peerName: string;
  features: ChatFeatures;
  onPick: (a: AttachAction) => void;
  onCustomize: () => void;
  onClose: () => void;
  allowedActions?: AttachAction[];
}

/** A small switch, drawn like the Light / Dark radio toggles in the design. */
function ThemeSwitch({ on, label, theme, onPress }: { on: boolean; label: string; theme: typeof light; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`Switch to ${label.toLowerCase()} mode`} hitSlop={6} style={styles.switchRow}>
      <View style={[styles.track, { backgroundColor: theme.toggleBg, opacity: on ? 1 : 0.45 }]}>
        <View style={[styles.knob, { backgroundColor: theme.toggleCircle, left: on ? 2 : 18 }]} />
      </View>
      <Text style={[styles.switchLabel, { color: theme.textMain, fontWeight: on ? "800" : "500" }]}>{label}</Text>
    </Pressable>
  );
}

function Tile({ tile, theme, onPress }: { tile: (typeof TILES)[number]; theme: typeof light; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tile.warn ? `${tile.label}, not end-to-end encrypted` : `Share via ${tile.label}`}
      style={styles.tileSlot}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.tile,
            { backgroundColor: theme.option, shadowColor: pressed ? tile.color : theme.shadow, borderColor: pressed ? tile.color : "transparent", transform: [{ scale: pressed ? 1.05 : 1 }] },
            tile.warn && { borderStyle: "dashed", borderColor: tile.color },
          ]}
        >
          <FontAwesome5 name={tile.icon} size={26} color={tile.color} style={styles.icon} />
          <Text numberOfLines={2} style={[styles.label, { color: theme.textMain }]}>{tile.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function AttachSheet({ visible, peerName, features, onPick, onCustomize, onClose, allowedActions }: Props) {
  const [isDark, setIsDark] = useState(rememberedDark);
  const theme = isDark ? dark : light;
  const choose = (next: boolean) => { rememberedDark = next; setIsDark(next); };
  const tiles = TILES.filter((t) => features[t.feature] && (!allowedActions || allowedActions.includes(t.action)));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <ModalSafe>
        <Pressable style={[styles.scrim, { backgroundColor: theme.scrim }]} onPress={onClose} accessibilityLabel="Close menu" />
        <View style={[styles.sheet, { backgroundColor: theme.surface }]} accessibilityViewIsModal>
          <View style={[styles.grip, { backgroundColor: theme.border }]} />

          <View style={styles.themeRow}>
            <ThemeSwitch on={!isDark} label="Light" theme={theme} onPress={() => choose(false)} />
            <ThemeSwitch on={isDark} label="Dark" theme={theme} onPress={() => choose(true)} />
          </View>

          <View style={styles.head}>
            <Text style={[styles.title, { color: theme.textMain }]}>Share with {peerName}</Text>
            <Pressable onPress={onCustomize} accessibilityRole="button" accessibilityLabel="Customize sharing options" hitSlop={8}>
              <Text style={[styles.link, { color: theme.accent }]}>Customize</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
            {tiles.map((t) => (
              <Tile key={t.action} tile={t} theme={theme} onPress={() => onPick(t.action)} />
            ))}
          </ScrollView>

          <Text style={[styles.note, { color: theme.textMuted }]}>
            Everything here is encrypted on your phone before it's sent.{features.ai ? " AI image prompts are the one exception." : ""}
          </Text>
          <BottomInsetSpacer min={0} extra={4} />
        </View>
      </ModalSafe>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6, maxHeight: "92%" },
  grip: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, marginBottom: 8 },
  themeRow: { flexDirection: "row", justifyContent: "flex-end", gap: 18, marginBottom: 6 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  track: { width: 36, height: 20, borderRadius: 10 },
  knob: { position: "absolute", top: 2, width: 16, height: 16, borderRadius: 8 },
  switchLabel: { fontSize: 14, fontWeight: "600" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "700" },
  link: { fontWeight: "600", fontSize: 14 },
  scroll: { flexGrow: 0 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingBottom: 6 },
  tileSlot: { width: "25%", padding: 4 },
  tile: {
    minHeight: 92,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  icon: { marginBottom: 8 },
  label: { fontSize: 11.5, textAlign: "center", lineHeight: 14 },
  note: { fontSize: 12, textAlign: "center", marginTop: 12, marginBottom: 6 },
});

// The "+" menu. Shows only the features turned on for this chat in
// Conversation settings > Chat features.

import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { palette as c, space } from "../ui/tokens";

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

const TILES: { action: AttachAction; label: string; feature: keyof ChatFeatures; d: string; warn?: boolean }[] = [
  { action: "photos", label: "Photos", feature: "media", d: "M3 5h18v14H3z M3 16l5-5 5 5 3-3 5 5" },
  { action: "camera", label: "Camera", feature: "media", d: "M4 7h3l2-2h6l2 2h3v12H4z M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
  { action: "protected", label: "Protected photo", feature: "media", d: "M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z M9 12l2 2 4-4" },
  { action: "document", label: "Document", feature: "media", d: "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6" },
  { action: "design", label: "Design / crop", feature: "media", d: "M6 3v15h15 M3 6h15v15" },
  { action: "location", label: "Location", feature: "location", d: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" },
  { action: "contact", label: "Contact", feature: "location", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" },
  { action: "poll", label: "Poll", feature: "polls", d: "M5 20V10 M12 20V4 M19 20v-7" },
  { action: "event", label: "Event", feature: "meetings", d: "M4 5h16v15H4z M4 9h16 M8 2v4 M16 2v4" },
  { action: "meeting", label: "Meeting", feature: "meetings", d: "M3 7h12v10H3z M15 11l6-3v8l-6-3" },
  { action: "voice", label: "Voice", feature: "voice", d: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3" },
  { action: "video", label: "Video clip", feature: "voice", d: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
  { action: "screen", label: "Share screen", feature: "screen", d: "M3 4h18v12H3z M8 20h8 M12 16v4 M12 13V7 M9 10l3-3 3 3" },
  { action: "whiteboard", label: "Whiteboard", feature: "screen", d: "M3 4h18v13H3z M7 21l2-4 M17 21l-2-4 M7 13l3-4 3 3 4-5" },
  { action: "ai", label: "AI image", feature: "ai", d: "M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z", warn: true },
];

interface Props {
  visible: boolean;
  peerName: string;
  features: ChatFeatures;
  onPick: (a: AttachAction) => void;
  onCustomize: () => void;
  onClose: () => void;
  allowedActions?: AttachAction[];
}

export function AttachSheet({ visible, peerName, features, onPick, onCustomize, onClose, allowedActions }: Props) {
  const tiles = TILES.filter((t) => features[t.feature] && (!allowedActions || allowedActions.includes(t.action)));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.grip} />
        <View style={styles.head}>
          <Text style={styles.title}>Share with {peerName}</Text>
          <Pressable onPress={onCustomize} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.link}>Customize</Text>
          </Pressable>
        </View>
        <View style={styles.grid}>
          {tiles.map((t) => (
            <Pressable key={t.action} onPress={() => onPick(t.action)} accessibilityRole="button" accessibilityLabel={t.warn ? `${t.label}, not end-to-end encrypted` : t.label} style={styles.tile}>
              <View style={[styles.disc, t.warn && styles.discWarn]}>
                <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={t.warn ? c.warn : c.secure} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                  <Path d={t.d} />
                </Svg>
              </View>
              <Text style={styles.label}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>
          Everything here is encrypted on your phone before it's sent.{features.ai ? " AI image prompts are the one exception." : ""}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(20,27,34,0.45)" },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space.l, paddingBottom: 34, paddingTop: space.s, gap: space.l },
  grip: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.line },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 17, fontWeight: "600", color: c.ink },
  link: { color: c.secure, fontWeight: "600", fontSize: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: space.l },
  tile: { width: "25%", alignItems: "center", gap: 6 },
  disc: { width: 56, height: 56, borderRadius: 18, backgroundColor: c.secureTint, alignItems: "center", justifyContent: "center" },
  discWarn: { backgroundColor: c.warnSurface, borderWidth: 1.5, borderStyle: "dashed", borderColor: c.warn },
  label: { fontSize: 12, color: c.ink, textAlign: "center" },
  note: { fontSize: 12, lineHeight: 17, color: c.muted, backgroundColor: c.bg, padding: space.m, borderRadius: 12 },
});

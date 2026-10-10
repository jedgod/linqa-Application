import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Theme } from "../../services/conversation-engine";
import { ACTION_ICONS, THREAD_ACTIONS, unavailableReason, type ThreadAction } from "../../services/conversation-thread";

/** What the + button offers, in this order. */
const PLUS_ACTIONS: ThreadAction[] = ["PHOTO", "DESIGN", "DOCUMENT", "LOCATION", "CONTACT", "POLL", "EVENT", "MEETING", "VOICE", "VIDEO", "LIVE_SCREEN", "AI_IMAGE"];
const LOCAL_ACTIONS: ThreadAction[] = ["PHOTO", "DESIGN", "VOICE", "VIDEO"];

/**
 * The + menu: pick from the gallery, or start Document, AI image, Location, Contact, Poll, Event, Schedule meeting or Share live
 * screen. An action this build cannot run yet is dimmed and, when tapped, says why; it is never presented as working.
 */
export function AttachmentChoices({ theme: t, peerFirstName, onClose, onGallery, onMore, onAction, canUse = true }: {
  theme: Theme;
  peerFirstName?: string;
  onClose: () => void;
  onGallery: () => void;
  /** Kept for the full "Add to chat" sheet (all features, including those switched off here). */
  onMore: () => void;
  onAction?: (action: ThreadAction) => void;
  /** Whether messaging is live and the chat is not blocked. */
  canUse?: boolean;
}) {
  const [why, setWhy] = useState<string | null>(null);
  const rows = PLUS_ACTIONS.map((id) => THREAD_ACTIONS.find((a) => a.id === id)!);
  const press = (id: ThreadAction) => {
    const reason = LOCAL_ACTIONS.includes(id) ? null : unavailableReason(id);
    if (reason) { setWhy(reason); return; }
    if (!canUse && !LOCAL_ACTIONS.includes(id)) { setWhy("Secure messaging has to be available on this device first."); return; }
    onClose();
    onAction?.(id);
  };
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close attachments" onPress={onClose} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "#0006" }}>
        <Pressable accessible={false} onPress={() => undefined} style={{ backgroundColor: t.surface, padding: 22, paddingBottom: 40, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "80%" }}>
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, marginBottom: 18 }} />
          <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 22, fontWeight: "600" }}>{peerFirstName ? `Share with ${peerFirstName}` : "Share to chat"}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Pressable accessibilityRole="button" onPress={onGallery} style={{ minHeight: 52, flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Ionicons name="images-outline" size={24} color={t.ink} />
              <View><Text style={{ color: t.ink, fontSize: 16 }}>All photos</Text><Text style={{ color: t.muted, fontSize: 12 }}>Choose and preview before sending</Text></View>
            </Pressable>
            <View style={{ flexDirection: "row", flexWrap: "wrap", paddingTop: 12 }}>
            {rows.map((a) => {
              const blocked = !LOCAL_ACTIONS.includes(a.id) && (!!unavailableReason(a.id) || !canUse);
              const label = a.id === "DESIGN" ? "Edit photo" : a.id === "VIDEO" ? "Video clip" : a.id === "VOICE" ? "Voice" : a.id === "LIVE_SCREEN" ? "Share screen" : a.label;
              return (
                <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`${label}${blocked ? ". Unavailable; tap for details" : ""}`} onPress={() => press(a.id)}
                  style={{ width: "25%", minHeight: 100, alignItems: "center", gap: 8, paddingHorizontal: 3, opacity: blocked ? 0.5 : 1 }}>
                  <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: t.background, alignItems: "center", justifyContent: "center" }}><Ionicons name={ACTION_ICONS[a.id] as keyof typeof Ionicons.glyphMap} size={24} color={t.accent} /></View>
                  <Text style={{ color: t.ink, fontSize: 12, textAlign: "center" }}>{label}</Text>
                </Pressable>
              );
            })}
            </View>
            <View style={{ flexDirection: "row", gap: 8, paddingVertical: 12 }}><Ionicons name="lock-closed-outline" size={16} color={t.secure} /><Text style={{ color: t.muted, flex: 1, fontSize: 12 }}>Attachments are encrypted on your device before sending. AI image generation is not connected yet.</Text></View>
            <Pressable accessibilityRole="button" onPress={onMore} style={{ minHeight: 52, justifyContent: "center" }}>
              <Text style={{ color: t.accent, fontSize: 16 }}>More attachments</Text>
            </Pressable>
          </ScrollView>
          {why ? <Text accessibilityRole="alert" style={{ color: t.warn, marginTop: 8 }}>{why}</Text> : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={{ minHeight: 52, justifyContent: "center" }}>
            <Text style={{ color: t.muted, fontSize: 16 }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

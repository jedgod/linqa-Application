// One sheet for the Calls page: start a call with someone now, or schedule one for later.
// People come from the user's own chats, so only people connected on Linqa can be picked.

import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getApiBaseUrl } from "../../config/api";
import { avatarUri } from "../../lib/profileApi";
import { accessTokenProvider } from "../../services/session";
import { CallsService, schedulePresets, formatScheduledFor } from "../../services/calls.service";
import { ChatInboxService } from "../../services/chat-inbox.service";
import { startSecureCallForPeer } from "../../services/secure-call-rooms";
import { useAvatarImage } from "../account/Avatar";

export type PlannerMode = "now" | "schedule";
type Person = { userId: string; name: string; photo: string | null };

const INK = "#F7F9FF";
const MUTED = "#A6B4DC";
const BLUE = "#068BFF";

function PersonPhoto({ person, size = 44 }: { person: Person; size?: number }) {
  const { displayUri } = useAvatarImage(person.photo);
  return displayUri ? (
    <Image source={{ uri: displayUri }} style={{ width: size, height: size, borderRadius: 10 }} resizeMode="cover" />
  ) : (
    <View style={[styles.initial, { width: size, height: size }]}>
      <Text style={styles.initialText}>{person.name.trim().charAt(0).toUpperCase() || "?"}</Text>
    </View>
  );
}

export function CallPlanner({ visible, initialMode, onClose, onScheduled }: { visible: boolean; initialMode: PlannerMode; onClose: () => void; onScheduled: () => void }) {
  const [mode, setMode] = useState<PlannerMode>(initialMode);
  const [kind, setKind] = useState<"AUDIO" | "VIDEO">("VIDEO");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [when, setWhen] = useState("1h");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const presets = useMemo(() => (visible ? schedulePresets() : []), [visible]);

  useEffect(() => {
    if (!visible) return;
    setMode(initialMode); setPicked([]); setMessage(null); setPeople(null);
    let alive = true;
    const inbox = new ChatInboxService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
    inbox.inbox("all").then((data) => {
      if (!alive) return;
      const seen = new Set<string>();
      setPeople(data.conversations.flatMap((c) => {
        if (c.isGroup || !c.peerUserId || seen.has(c.peerUserId)) return [];
        seen.add(c.peerUserId);
        return [{ userId: c.peerUserId, name: c.title, photo: avatarUri(c.peerAvatarUrl) }];
      }));
    }).catch(() => { if (alive) { setPeople([]); setMessage("Could not load your contacts. Try again."); } });
    return () => { alive = false; };
  }, [visible, initialMode]);

  const toggle = (id: string) => setPicked((now) => (mode === "now" ? (now[0] === id ? [] : [id]) : now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));

  async function submit() {
    if (!picked.length || busy) return;
    setBusy(true); setMessage(null);
    try {
      if (mode === "now") {
        const problem = await startSecureCallForPeer(picked[0]!, kind);
        if (problem) setMessage(problem); else onClose();
      } else {
        const at = presets.find((p) => p.key === when)?.at;
        if (!at) throw new Error("Choose a time.");
        const service = new CallsService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
        await service.schedule({ participantUserIds: picked, callType: kind, privacyMode: "STANDARD", scheduledFor: at.toISOString() });
        onScheduled(); onClose();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not complete that. Try again.");
    } finally { setBusy(false); }
  }

  const ready = picked.length > 0 && !busy;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismiss} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{mode === "now" ? "New call" : "Schedule a call"}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={24} color={INK} /></Pressable>
          </View>

          <View style={styles.segment}>
            {(["now", "schedule"] as const).map((m) => (
              <Pressable key={m} onPress={() => { setMode(m); setPicked((p) => (m === "now" ? p.slice(0, 1) : p)); }} style={[styles.segItem, mode === m && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
                <Text style={[styles.segText, mode === m && styles.segTextOn]}>{m === "now" ? "Call now" : "Schedule"}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.segment}>
            {(["VIDEO", "AUDIO"] as const).map((k) => (
              <Pressable key={k} onPress={() => setKind(k)} style={[styles.segItem, kind === k && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: kind === k }}>
                <Ionicons name={k === "VIDEO" ? "videocam" : "call"} size={16} color={kind === k ? "#fff" : MUTED} />
                <Text style={[styles.segText, kind === k && styles.segTextOn]}>{k === "VIDEO" ? "Video" : "Voice"}</Text>
              </Pressable>
            ))}
          </View>

          {mode === "schedule" ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {presets.map((p) => (
                <Pressable key={p.key} onPress={() => setWhen(p.key)} style={[styles.chip, when === p.key && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: when === p.key }}>
                  <Text style={[styles.chipLabel, when === p.key && { color: "#fff" }]}>{p.label}</Text>
                  <Text style={styles.chipSub}>{formatScheduledFor(p.at.toISOString())}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <Text style={styles.section}>{mode === "now" ? "Who to call" : "Who to invite"}</Text>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {people === null ? <ActivityIndicator color={BLUE} style={{ marginTop: 24 }} /> : null}
            {people?.length === 0 && !message ? <Text style={styles.empty}>Start a chat with someone first. Calls are with people you are connected to on Linqa.</Text> : null}
            {people?.map((p) => {
              const on = picked.includes(p.userId);
              return (
                <Pressable key={p.userId} onPress={() => toggle(p.userId)} style={[styles.row, on && styles.rowOn]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={p.name}>
                  <PersonPhoto person={p} />
                  <Text numberOfLines={1} style={styles.name}>{p.name}</Text>
                  <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={24} color={on ? BLUE : MUTED} />
                </Pressable>
              );
            })}
          </ScrollView>

          {message ? <Text style={styles.error} accessibilityLiveRegion="polite">{message}</Text> : null}
          <Pressable onPress={() => void submit()} disabled={!ready} style={[styles.go, !ready && { opacity: 0.45 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.goText}>{mode === "now" ? (kind === "VIDEO" ? "Start video call" : "Start voice call") : "Schedule call"}</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,10,29,0.7)" },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: "#07142C", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 26, maxHeight: "86%", borderColor: "#203357", borderWidth: 1 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { color: INK, fontSize: 21, fontWeight: "700" },
  segment: { flexDirection: "row", backgroundColor: "#0A1935", borderRadius: 12, padding: 3, marginBottom: 10 },
  segItem: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 9, borderRadius: 10 },
  segOn: { backgroundColor: BLUE },
  segText: { color: MUTED, fontWeight: "600", fontSize: 14 },
  segTextOn: { color: "#fff" },
  chip: { borderRadius: 12, borderWidth: 1, borderColor: "#203357", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#0A1935" },
  chipOn: { backgroundColor: BLUE, borderColor: BLUE },
  chipLabel: { color: INK, fontWeight: "600", fontSize: 14 },
  chipSub: { color: MUTED, fontSize: 11, marginTop: 2 },
  section: { color: MUTED, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, marginTop: 10, marginBottom: 4, textTransform: "uppercase" },
  list: { minHeight: 120, maxHeight: 320 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12 },
  rowOn: { backgroundColor: "#0D2347" },
  name: { flex: 1, color: INK, fontSize: 16, fontWeight: "600" },
  initial: { borderRadius: 10, backgroundColor: "#3A2BB0", alignItems: "center", justifyContent: "center" },
  initialText: { color: "#fff", fontWeight: "700", fontSize: 18 },
  empty: { color: MUTED, textAlign: "center", marginTop: 24, lineHeight: 20 },
  error: { color: "#FF5B67", marginTop: 8, textAlign: "center" },
  go: { marginTop: 12, backgroundColor: BLUE, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  goText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});

// One sheet for the Calls page: start a call with someone now, or schedule one for later.
// People come from the user's own chats, so only people connected on Linqa can be picked.

import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
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

/**
 * One clear label per time. A relative preset ("In 30 min") gets its clock time beside it; a preset that already
 * names the day ("Tomorrow 9:00") shows just the formatted time ("Tomorrow 9:00 AM"), so nothing is said twice.
 */
function presetText(p: { key: string; label: string; at: Date }): { label: string; sub?: string; joined: string } {
  const clock = formatScheduledFor(p.at.toISOString());
  if (p.key.startsWith("tomorrow")) return { label: clock, joined: clock };
  return { label: p.label, sub: clock, joined: `${p.label} · ${clock}` };
}

type Option = { key: string; label: string; sub?: string };

/** A labelled drop-down: the heading, the current choice, and the choices listed under it when opened. */
function Dropdown({ heading, value, options, selectedKey, open, disabled, onToggle, onSelect }: { heading: string; value: string; options: Option[]; selectedKey: string; open: boolean; disabled?: boolean; onToggle: () => void; onSelect: (key: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.heading}>{heading}</Text>
      <Pressable onPress={onToggle} disabled={disabled} style={[styles.select, open && styles.selectOpen, disabled && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`${heading}: ${value}`} accessibilityState={{ expanded: open, disabled: !!disabled }}>
        <Text numberOfLines={1} style={styles.selectText}>{value}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={MUTED} />
      </Pressable>
      {open ? (
        <View style={styles.menu}>
          {options.map((o) => (
            <Pressable key={o.key} onPress={() => onSelect(o.key)} style={[styles.menuItem, o.key === selectedKey && styles.menuItemOn]} accessibilityRole="menuitem" accessibilityState={{ selected: o.key === selectedKey }}>
              <Text style={styles.menuLabel}>{o.label}</Text>
              {o.sub ? <Text style={styles.menuSub}>{o.sub}</Text> : null}
              {o.key === selectedKey ? <Ionicons name="checkmark" size={18} color={BLUE} style={{ marginLeft: "auto" }} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

type PlannerProps = { visible: boolean; initialMode: PlannerMode; onClose: () => void; onScheduled: () => void };

// A Modal is its own window on Android, so it needs its own safe-area provider to know where the system bars are.
export function CallPlanner(props: PlannerProps) {
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaProvider>
        <PlannerSheet {...props} />
      </SafeAreaProvider>
    </Modal>
  );
}

function PlannerSheet({ visible, initialMode, onClose, onScheduled }: PlannerProps) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<PlannerMode>(initialMode);
  const [kind, setKind] = useState<"AUDIO" | "VIDEO">("VIDEO");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [when, setWhen] = useState("1h");
  const [open, setOpen] = useState<"mode" | "when" | "kind" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const presets = useMemo(() => (visible ? schedulePresets() : []), [visible]);

  useEffect(() => {
    if (!visible) return;
    setMode(initialMode); setPicked([]); setMessage(null); setPeople(null); setOpen(null);
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
    <>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismiss} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 16, maxHeight: "92%" }]}>
          <View style={styles.head}>
            <Text style={styles.title}>{mode === "now" ? "New call" : "Schedule a call"}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={24} color={INK} /></Pressable>
          </View>

          <Dropdown
            heading="Schedule"
            open={open === "mode"}
            onToggle={() => setOpen(open === "mode" ? null : "mode")}
            value={mode === "now" ? "Call now" : "Schedule"}
            options={[{ key: "now", label: "Call now" }, { key: "schedule", label: "Schedule" }]}
            selectedKey={mode}
            onSelect={(key) => { const m = key as PlannerMode; setMode(m); setPicked((p) => (m === "now" ? p.slice(0, 1) : p)); setOpen(null); }}
          />

          <Dropdown
            heading="Time / Period"
            disabled={mode === "now"}
            open={open === "when"}
            onToggle={() => setOpen(open === "when" ? null : "when")}
            value={mode === "now" ? "Right now" : (() => { const p = presets.find((x) => x.key === when); return p ? presetText(p).joined : "Choose a time"; })()}
            options={presets.map((p) => ({ key: p.key, label: presetText(p).label, sub: presetText(p).sub }))}
            selectedKey={when}
            onSelect={(key) => { setWhen(key); setOpen(null); }}
          />

          <Dropdown
            heading="Call type"
            open={open === "kind"}
            onToggle={() => setOpen(open === "kind" ? null : "kind")}
            value={kind === "VIDEO" ? "Video" : "Voice"}
            options={[{ key: "VIDEO", label: "Video" }, { key: "AUDIO", label: "Voice" }]}
            selectedKey={kind}
            onSelect={(key) => { setKind(key as "AUDIO" | "VIDEO"); setOpen(null); }}
          />

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
    </>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 10 },
  heading: { color: MUTED, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, marginBottom: 6, textTransform: "uppercase" },
  select: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, backgroundColor: "#0A1935", borderWidth: 1, borderColor: "#203357", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  selectOpen: { borderColor: BLUE },
  selectText: { flex: 1, color: INK, fontSize: 15, fontWeight: "600" },
  menu: { marginTop: 6, backgroundColor: "#0A1935", borderWidth: 1, borderColor: "#203357", borderRadius: 12, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  menuItemOn: { backgroundColor: "#0D2347" },
  menuLabel: { color: INK, fontSize: 15, fontWeight: "600" },
  menuSub: { color: MUTED, fontSize: 12 },
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
  list: { minHeight: 96, maxHeight: 220 },
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

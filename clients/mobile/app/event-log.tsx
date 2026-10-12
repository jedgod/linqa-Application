import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { removeMyEvent, upcomingOf, useMyEvents, type MyEvent } from "../services/my-events";

const when = (e: MyEvent) => {
  const s = new Date(e.startsAt);
  const day = s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t(s)}${e.endsAt ? ` to ${t(new Date(e.endsAt))}` : ""}`;
};

function Row({ e, past }: { e: MyEvent; past?: boolean }) {
  const confirmRemove = () => Alert.alert("Remove from the event log?", `"${e.title}" will be removed from Upcoming and the log. The message in your chat stays.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: () => { void removeMyEvent(e.id); } }
  ]);
  return (
    <View style={[s.row, past && { opacity: 0.6 }]} accessible accessibilityLabel={`${e.kind === "meeting" ? "Meeting" : "Event"}: ${e.title}, ${when(e)}`}>
      <View style={s.badge}><Ionicons name={e.kind === "meeting" ? "videocam-outline" : "calendar-outline"} size={20} color="#4F46E5" /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.title} numberOfLines={2}>{e.title}</Text>
        <Text style={s.meta}>{when(e)}</Text>
        {e.place ? <Text style={s.meta} numberOfLines={1}>{e.place}</Text> : null}
        <Text style={s.kind}>{e.kind === "meeting" ? "Meeting" : "Event"}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${e.title}`} onPress={confirmRemove} hitSlop={10} style={s.remove}><Ionicons name="trash-outline" size={20} color="#94A3B8" /></Pressable>
    </View>
  );
}

/** Every event and meeting added to Linqa from a chat: what is coming up, and what already happened. */
export default function EventLogScreen() {
  const router = useRouter();
  const { items, loaded } = useMyEvents();
  const upcoming = upcomingOf(items);
  const past = items.filter((e) => !upcoming.includes(e)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))} hitSlop={12} style={s.back}><Ionicons name="chevron-back" size={28} color="#0F172A" /></Pressable>
        <Text style={s.heading}>Event log</Text>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.section}>UPCOMING</Text>
        {upcoming.length === 0 ? <Text style={s.empty}>{loaded ? "Nothing coming up. Tap Add to calendar on an event or meeting in a chat to add it here." : "Loading…"}</Text> : upcoming.map((e) => <Row key={e.id} e={e} />)}
        {past.length > 0 ? (<><Text style={[s.section, { marginTop: 22 }]}>PAST</Text>{past.map((e) => <Row key={e.id} e={e} past />)}</>) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6FA" },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 22, fontWeight: "800", color: "#0F172A" },
  content: { padding: 16, paddingBottom: 40 },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, color: "#64748B", marginBottom: 8 },
  empty: { color: "#64748B", fontSize: 15, lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, marginBottom: 10 },
  badge: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "700", color: "#0F172A" },
  meta: { fontSize: 13, color: "#475569", marginTop: 2 },
  kind: { fontSize: 11, fontWeight: "700", color: "#4F46E5", marginTop: 6 },
  remove: { width: 36, height: 36, alignItems: "center", justifyContent: "center" }
});

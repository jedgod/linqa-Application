import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, IconBtn, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { useCollection, useMyCountry } from "../../components/countrylinqa/useWorld";
import { EVENT_TABS, eventWhen, flagOf, type EventTab } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

const TINTS = ["#EDE9FF", "#E3F1FF", "#FFF0E1", "#E4F7EF", "#FFE9EF"];
const tintFor = (id: string) => TINTS[[...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length]!;

/** 3.7 Events: upcoming events within your reach, with a private "Interested" you can set and clear. */
export default function CountryLinqaEvents() {
  const router = useRouter();
  const client = useCountryClient();
  const params = useLocalSearchParams<{ country?: string; title?: string }>();
  const me = useMyCountry();
  const [tab, setTab] = useState<EventTab>("FOR_YOU");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const place = !!params.country;
  const period = EVENT_TABS.find((t) => t.key === tab)!.period;
  const q = query.trim();
  const list = useCollection("events", { period, ...(params.country ? { country: params.country } : {}), ...(q ? { q } : {}) }, `${tab}|${q}|${params.country ?? ""}`);

  async function toggle(id: string, interested: boolean) {
    if (busy) return;
    setBusy(id); setNote(null);
    // Show the change at once; put it back if the server says no.
    const before = list.items;
    list.setItems(before.map((e) => (e.id === id ? { ...e, interested, interestedCount: Math.max(0, (e.interestedCount ?? 0) + (interested ? 1 : -1)) } : e)));
    try {
      const result = await client.setEventInterest(id, interested);
      list.setItems((rows) => rows.map((e) => (e.id === id ? { ...e, interested: result.interested, interestedCount: result.interestedCount } : e)));
    } catch (cause) {
      list.setItems(before);
      setNote(cause instanceof Error && cause.message === "EVENT_UNAVAILABLE" ? "This event is no longer available." : "Unable to update. Try again.");
    } finally { setBusy(null); }
  }

  return (
    <WorldScreen>
      <WorldHeader title={params.title ? `Events · ${params.title}` : "Events"} back={place}
        {...(place ? {} : me.name ? { subtitle: me.name, onSubtitle: () => router.push("/countrylinqa/countries") } : {})}
        right={<><IconBtn icon={searching ? "close" : "search"} label={searching ? "Close search" : "Search events"} onPress={() => { setSearching((v) => !v); setQuery(""); }} /><IconBtn icon="add-circle-outline" label="Create an event" onPress={() => router.push("/countrylinqa/create?type=event")} /></>} />
      {searching ? <View style={s.search}><Ionicons name="search" size={18} color={world.faint} /><TextInput autoFocus accessibilityLabel="Search events" value={query} onChangeText={setQuery} placeholder="Search events" placeholderTextColor={world.faint} style={s.searchInput} /></View> : null}
      <View style={s.tabs} accessibilityRole="tablist">
        {EVENT_TABS.map((t) => (
          <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }} style={[s.tab, tab === t.key && s.tabOn]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabText, tab === t.key && { color: world.purple, fontFamily: fonts.bold }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
        {note ? <Text style={s.error} accessibilityLiveRegion="polite">{note}</Text> : null}
        {list.error ? <Empty icon="cloud-offline-outline" title="Can not load events" text={list.error} action={{ label: "Try again", onPress: () => void list.reload() }} /> : null}
        {list.loading && list.items.length === 0 ? <Spinner /> : null}
        {list.items.map((e) => (
          <View key={e.id} style={s.row}>
            <View style={[s.tile, { backgroundColor: tintFor(e.id) }]} accessibilityElementsHidden importantForAccessibility="no">
              <Text style={s.tileFlag}>{e.countryCode ? flagOf(e.countryCode) : "🎉"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={2}>{e.title}</Text>
              <Text style={s.meta} numberOfLines={1}>{[e.city, e.countryCode].filter(Boolean).join(", ")}</Text>
              <View style={s.when}><Ionicons name="calendar-outline" size={14} color={world.muted} /><Text style={s.meta}>{eventWhen(e.startsAt)}</Text></View>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: !!e.interested, disabled: busy === e.id }} accessibilityLabel={`${e.interested ? "Remove interest in" : "Interested in"} ${e.title}`} disabled={busy === e.id} style={[s.interest, e.interested && s.interestOn]} onPress={() => void toggle(e.id, !e.interested)}>
                {e.interested ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                <Text style={[s.interestText, e.interested && { color: "#FFFFFF" }]}>Interested{(e.interestedCount ?? 0) > 0 ? ` · ${e.interestedCount}` : ""}</Text>
              </Pressable>
            </View>
          </View>
        ))}
        {!list.loading && !list.error && list.items.length === 0 ? <Empty icon="calendar-outline" title="No upcoming events" text="Events outside your discovery reach never appear here. Try another tab, or widen your reach in settings." action={{ label: "Discovery settings", onPress: () => router.push("/settings/countrylinqa") }} /> : null}
        {list.page && !list.loading ? <Pressable accessibilityRole="button" style={s.more} onPress={() => void list.more()}><Text style={s.moreText}>Load more</Text></Pressable> : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 46, marginHorizontal: 20, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: world.border, paddingHorizontal: 12 },
  searchInput: { flex: 1, color: world.text, fontFamily: fonts.regular, fontSize: 15 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingVertical: 8 },
  tab: { flex: 1, minHeight: 40, borderRadius: 12, backgroundColor: "#F5F6FB", alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: world.soft },
  tabText: { color: world.muted, fontFamily: fonts.medium, fontSize: 13 },
  list: { paddingHorizontal: 20, paddingBottom: 28 },
  row: { flexDirection: "row", gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: world.border },
  tile: { width: 92, height: 124, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tileFlag: { fontSize: 38 },
  title: { color: world.text, fontFamily: fonts.bold, fontSize: 16 },
  meta: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  when: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 },
  interest: { flexDirection: "row", gap: 6, minHeight: 40, borderRadius: 10, backgroundColor: world.soft, alignItems: "center", justifyContent: "center", marginTop: 10 },
  interestOn: { backgroundColor: world.purple },
  interestText: { color: world.purple, fontFamily: fonts.semibold, fontSize: 14 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 8 },
  more: { alignItems: "center", justifyContent: "center", minHeight: 56 },
  moreText: { color: world.purple, fontFamily: fonts.bold, fontSize: 16 }
});

import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, IconBtn, Spinner, CountryMenu, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { useCollection, useMyCountry } from "../../components/countrylinqa/useWorld";
import type { CountryItem } from "../../services/countrylinqa.service";
import { PEOPLE_TABS, communityFilters, flagOf, membersLabel, rankCommunities, type PeopleTab } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

/** 3.6 Communities: the country communities you have joined, and the ones within your reach to discover. */
export default function CountryLinqaCommunities() {
  const router = useRouter();
  const client = useCountryClient();
  const params = useLocalSearchParams<{ country?: string; title?: string }>();
  const me = useMyCountry();
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<PeopleTab>("FOR_YOU");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const place = !!params.country;

  const tabFilters = place ? { country: params.country! } : communityFilters(tab, { country: me.code, region: me.region });
  const q = query.trim();
  const discover = useCollection("communities", tabFilters ? { ...tabFilters, ...(q ? { q } : {}) } : null, `${tab}|${q}|${params.country ?? ""}|${me.code ?? ""}`);
  const mine = useCollection("communities", { joinedOnly: true }, "mine");

  const discoverRows = useMemo(() => rankCommunities(discover.items.filter((i) => !i.joined), me.code), [discover.items, me.code]);

  async function toggle(item: CountryItem) {
    if (busy) return;
    setBusy(item.id); setNote(null);
    try {
      if (item.joined) await client.leaveCountryCommunity(item.id); else await client.joinCountryCommunity(item.id);
      await Promise.all([mine.reload(), discover.reload()]);
    } catch (cause) {
      setNote(cause instanceof Error && cause.message === "COMMUNITY_MEMBERSHIP_SUSPENDED" ? "Your membership in this community is suspended." : "Unable to update your membership. Try again.");
    } finally { setBusy(null); }
  }
  function leave(item: CountryItem) {
    Alert.alert(`Leave ${item.title}?`, "You can join again at any time.", [{ text: "Cancel", style: "cancel" }, { text: "Leave", style: "destructive", onPress: () => void toggle(item) }]);
  }
  const open = (item: CountryItem) => router.push({ pathname: "/countrylinqa/country", params: { code: item.id } });

  const row = (item: CountryItem, joined: boolean) => (
    <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.title} community, ${membersLabel(item.memberCount ?? 0)}`} style={s.row} onPress={() => open(item)}>
      <View style={s.avatar}><Text style={s.avatarFlag}>{flagOf(item.id)}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{item.title} Community</Text>
        <Text style={s.meta}>{membersLabel(item.memberCount ?? 0)}</Text>
      </View>
      {joined ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Leave ${item.title} community`} style={s.chev} onPress={() => leave(item)}><Ionicons name="checkmark-circle" size={24} color={world.purple} /></Pressable>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Join ${item.title} community`} accessibilityState={{ disabled: !!busy || !!item.suspended }} disabled={!!busy || !!item.suspended} style={s.join} onPress={() => void toggle(item)}>
          <Text style={s.joinText}>{item.suspended ? "Suspended" : busy === item.id ? "…" : "Join"}</Text>
        </Pressable>
      )}
    </Pressable>
  );

  return (
    <WorldScreen>
      <WorldHeader title={params.title ? `${params.title}` : "Communities"} back={place}
        {...(place ? {} : me.name ? { subtitle: me.name, onSubtitle: () => setMenu((v) => !v), subtitleOpen: menu } : {})}
        right={<IconBtn icon={searching ? "close" : "search"} label={searching ? "Close search" : "Search communities"} onPress={() => { setSearching((v) => !v); setQuery(""); }} />} />
      <CountryMenu open={menu} onClose={() => setMenu(false)} target="communities" />
      {searching ? <View style={s.search}><Ionicons name="search" size={18} color={world.faint} /><TextInput autoFocus accessibilityLabel="Search communities" value={query} onChangeText={setQuery} placeholder="Search communities" placeholderTextColor={world.faint} style={s.searchInput} /></View> : null}
      {!place ? (
        <View style={s.tabs} accessibilityRole="tablist">
          {PEOPLE_TABS.map((t) => (
            <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }} style={[s.tab, tab === t.key && s.tabOn]} onPress={() => setTab(t.key)}>
              <Text style={[s.tabText, tab === t.key && { color: world.purple, fontFamily: fonts.bold }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
        {note ? <Text style={s.error} accessibilityLiveRegion="polite">{note}</Text> : null}
        {mine.items.length ? (<><Text style={s.section}>My Communities</Text>{mine.items.map((i) => row(i, true))}</>) : null}
        <Text style={s.section}>Discover Communities</Text>
        {discover.error ? <Empty icon="cloud-offline-outline" title="Can not load communities" text={discover.error} action={{ label: "Try again", onPress: () => void discover.reload() }} /> : null}
        {discover.loading && discoverRows.length === 0 ? <Spinner /> : null}
        {discoverRows.map((i) => row(i, false))}
        {!discover.loading && !discover.error && discoverRows.length === 0 ? (
          <Empty icon="people-circle-outline" title={discover.items.length ? "You have joined them all" : "No communities here yet"} text={discover.items.length ? "Check another tab to find more." : tabFilters ? "Communities outside your discovery reach never appear here. You can widen it in settings." : "Confirm your country to see communities near you."}
            action={{ label: "Discovery settings", onPress: () => router.push("/settings/countrylinqa") }} />
        ) : null}
        {discover.page && !discover.loading ? <Pressable accessibilityRole="button" style={s.more} onPress={() => void discover.more()}><Text style={s.moreText}>Load more</Text></Pressable> : null}
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
  section: { color: world.text, fontFamily: fonts.extrabold, fontSize: 17, marginTop: 18, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 74, borderBottomWidth: 1, borderBottomColor: world.border },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#EEF0FF", alignItems: "center", justifyContent: "center" },
  avatarFlag: { fontSize: 28 },
  name: { color: world.text, fontFamily: fonts.bold, fontSize: 16 },
  meta: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  chev: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  join: { minWidth: 70, minHeight: 36, paddingHorizontal: 14, borderRadius: 9, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  joinText: { color: "#FFFFFF", fontFamily: fonts.semibold, fontSize: 14 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 8 },
  more: { alignItems: "center", justifyContent: "center", minHeight: 56 },
  moreText: { color: world.purple, fontFamily: fonts.bold, fontSize: 16 }
});

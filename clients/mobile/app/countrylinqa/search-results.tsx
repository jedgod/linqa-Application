import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, PersonRow, Spinner, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { useCollection } from "../../components/countrylinqa/useWorld";
import { Avatar } from "../../components/linqasend/ui";
import { SORTS, activeFilterCount, decodeSearch, describeSearch, encodeSearch, sortRows, takePendingSearch, toCollectionFilters, toPeopleFilters, toSavedFilters, type SearchState } from "../../services/countrylinqa-search";
import { eventWhen, joinPeople, titleCase, type PersonDetail } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

type PersonRowData = { id: string; name: string; detail: PersonDetail };

/** 4.2 Search Results: the same search, with Filter and Sort, and a way to save a people search. */
export default function CountryLinqaSearchResults() {
  const router = useRouter();
  const client = useCountryClient();
  const params = useLocalSearchParams<{ state?: string }>();
  const [state, setState] = useState<SearchState>(() => decodeSearch(params.state));
  const [people, setPeople] = useState<PersonRowData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [scope, setScope] = useState("Your discovery scope");
  const generation = useRef(0);
  const isPeople = state.kind === "people";

  const collection = useCollection(isPeople ? "people" : state.kind, isPeople ? null : { ...toCollectionFilters(state), period: "all" }, `${encodeSearch(state)}`);

  // Filters set on the Filters screen come back through a one-slot hand-off.
  useFocusEffect(useCallback(() => { const next = takePendingSearch(); if (next) setState(next); }, []));

  useEffect(() => {
    let active = true;
    client.catalog().then((catalog) => {
      if (!active) return;
      const country = catalog.countries.find((c) => c.code === state.country)?.name;
      const region = catalog.regions.find((r) => r.code === state.region)?.name;
      setScope(country ?? region ?? "Your discovery scope");
    }, () => undefined);
    return () => { active = false; };
  }, [client, state.country, state.region]);

  const loadPeople = useCallback(async (more: boolean) => {
    const mine = more ? generation.current : ++generation.current;
    setLoading(true); setError(null);
    if (!more) { setPeople([]); setCursor(null); }
    try {
      const page = await client.searchPeople(toPeopleFilters(state), { limit: 20, ...(more && cursor ? { cursor } : {}) });
      const details = await client.peopleDetails(page.items.map((p) => p.id));
      if (mine !== generation.current) return;
      const next = joinPeople(page.items, details).map((p) => ({ id: p.id, name: p.detail.displayName, detail: p.detail }));
      setPeople((old) => (more ? [...old, ...next.filter((n) => !old.some((o) => o.id === n.id))] : next));
      setCursor(page.nextCursor);
    } catch (cause) {
      if (mine === generation.current) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to search");
    } finally { if (mine === generation.current) setLoading(false); }
  }, [client, state, cursor]);

  // `loadPeople` changes with the cursor, so the search itself is the only trigger.
  const key = encodeSearch({ ...state, sort: "RELEVANT" });
  useEffect(() => { if (isPeople) void loadPeople(false); return () => { generation.current++; }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const sortedPeople = useMemo(() => sortRows(people, state.sort), [people, state.sort]);
  const sortedCollection = useMemo(() => sortRows(collection.items.map((i) => ({ ...i, name: i.title })), state.sort), [collection.items, state.sort]);
  const count = isPeople ? people.length : collection.items.length;
  const more = isPeople ? !!cursor : !!collection.page;
  const busy = isPeople ? loading : collection.loading;
  const failure = isPeople ? error : collection.error;
  const filters = activeFilterCount(state);

  async function saveSearch() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true); setNote(null);
    try { await client.saveSearch(trimmed, toSavedFilters(state)); setNote("Search saved."); setName(""); setTimeout(() => setNote(null), 2500); }
    catch (cause) { setNote(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to save this search."); }
    finally { setSaving(false); }
  }

  return (
    <WorldScreen>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.iconBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace("/countrylinqa/search"))}><Ionicons name="chevron-back" size={26} color={world.text} /></Pressable>
        <Text accessibilityRole="header" style={s.title}>Search Results</Text>
        {isPeople ? <Pressable accessibilityRole="button" accessibilityLabel="Save this search" style={s.iconBtn} onPress={() => setNote((v) => (v === "SAVE" ? null : "SAVE"))}><Ionicons name="bookmark-outline" size={22} color={world.purple} /></Pressable> : <View style={s.iconBtn} />}
      </View>
      <Text style={s.count} accessibilityLiveRegion="polite">{scope} • {busy && count === 0 ? "Searching…" : `${count}${more ? "+" : ""} ${count === 1 ? "result" : "results"}`}</Text>
      <Text style={s.desc} numberOfLines={2}>{describeSearch(state)}</Text>

      {note === "SAVE" ? (
        <View style={s.save}>
          <TextInput autoFocus accessibilityLabel="Name this search" value={name} onChangeText={setName} placeholder="Name this search" placeholderTextColor={world.faint} maxLength={80} style={s.saveInput} />
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving || !name.trim() }} disabled={saving || !name.trim()} style={[s.saveBtn, (saving || !name.trim()) && { opacity: 0.5 }]} onPress={() => void saveSearch()}><Text style={s.saveText}>{saving ? "…" : "Save"}</Text></Pressable>
        </View>
      ) : note ? <Text style={s.note} accessibilityLiveRegion="polite">{note}</Text> : null}

      <View style={s.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Filter${filters ? `, ${filters} active` : ""}`} style={s.pill} onPress={() => router.push({ pathname: "/countrylinqa/search-filters", params: { state: encodeSearch(state) } })}>
          <Ionicons name="options-outline" size={18} color={world.purple} /><Text style={s.pillText}>Filter</Text>{filters ? <View style={s.badge}><Text style={s.badgeText}>{filters}</Text></View> : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: sortOpen }} accessibilityLabel={`Sort, ${SORTS.find((x) => x.key === state.sort)!.label}`} style={s.pillRight} onPress={() => setSortOpen((v) => !v)}>
          <Text style={s.pillText}>Sort</Text><Ionicons name={sortOpen ? "chevron-up" : "chevron-down"} size={16} color={world.purple} />
        </Pressable>
      </View>
      {sortOpen ? (
        <View style={s.menu}>{SORTS.map((o) => (
          <Pressable key={o.key} accessibilityRole="radio" accessibilityState={{ selected: state.sort === o.key }} style={s.menuRow} onPress={() => { setState({ ...state, sort: o.key }); setSortOpen(false); }}>
            <Text style={s.menuText}>{o.label}</Text>{state.sort === o.key ? <Ionicons name="checkmark" size={18} color={world.purple} /> : null}
          </Pressable>
        ))}<Text style={s.menuNote}>Sorts the results loaded so far.</Text></View>
      ) : null}

      <ScrollView contentContainerStyle={s.list}>
        {failure ? <Empty icon="cloud-offline-outline" title="Can not search" text={failure} action={{ label: "Try again", onPress: () => (isPeople ? void loadPeople(false) : void collection.reload()) }} /> : null}
        {busy && count === 0 ? <Spinner /> : null}
        {isPeople ? sortedPeople.map((p) => <PersonRow key={p.id} person={p.detail} onOpen={() => router.push({ pathname: "/countrylinqa/person", params: { id: p.id } })} action={{ label: "View", onPress: () => router.push({ pathname: "/countrylinqa/person", params: { id: p.id } }) }} />) : null}
        {!isPeople && state.kind === "businesses" ? sortedCollection.map((b) => (
          <View key={b.id} style={s.row} accessible accessibilityLabel={`${b.title}${b.category ? `, ${titleCase(b.category)}` : ""}`}>
            <Avatar name={b.title} size={52} /><View style={{ flex: 1 }}><Text style={s.rowTitle} numberOfLines={2}>{b.title}</Text>{b.category ? <Text style={s.rowMeta}>{titleCase(b.category)}</Text> : null}</View>
          </View>
        )) : null}
        {!isPeople && state.kind === "events" ? sortedCollection.map((e) => (
          <Pressable key={e.id} accessibilityRole="button" style={s.row} onPress={() => router.push({ pathname: "/countrylinqa/events", params: e.countryCode ? { country: e.countryCode, title: e.countryCode } : {} })}>
            <View style={s.eventDot}><Ionicons name="calendar-outline" size={22} color={world.purple} /></View>
            <View style={{ flex: 1 }}><Text style={s.rowTitle} numberOfLines={2}>{e.title}</Text><Text style={s.rowMeta}>{[e.city, e.countryCode].filter(Boolean).join(", ")}</Text><Text style={s.rowMeta}>{eventWhen(e.startsAt)}</Text></View>
          </Pressable>
        )) : null}
        {!busy && !failure && count === 0 ? <Empty icon="search-outline" title="No results" text="Nothing matches. Try fewer filters. People outside your discovery reach never appear in results." action={{ label: "Change search", onPress: () => router.back() }} /> : null}
        {more && !busy ? <Pressable accessibilityRole="button" style={s.more} onPress={() => (isPeople ? void loadPeople(true) : void collection.more())}><Text style={s.moreText}>Load more</Text></Pressable> : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: 8, minHeight: 56 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: world.text, fontFamily: fonts.extrabold, fontSize: 18 },
  count: { paddingHorizontal: 20, color: world.muted, fontFamily: fonts.medium, fontSize: 14 },
  desc: { paddingHorizontal: 20, color: world.faint, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  save: { flexDirection: "row", gap: 8, marginHorizontal: 20, marginTop: 10 },
  saveInput: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: world.border, paddingHorizontal: 12, color: world.text, fontFamily: fonts.regular, fontSize: 15 },
  saveBtn: { height: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 14 },
  note: { paddingHorizontal: 20, color: world.purple, fontFamily: fonts.medium, fontSize: 13, marginTop: 8 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 12 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: 12, backgroundColor: world.soft },
  pillRight: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D9D2FF" },
  pillText: { color: world.purple, fontFamily: fonts.semibold, fontSize: 15 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: world.purple, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 12 },
  menu: { marginHorizontal: 20, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: world.border, paddingHorizontal: 14 },
  menuRow: { flexDirection: "row", alignItems: "center", minHeight: 46 },
  menuText: { flex: 1, color: world.text, fontFamily: fonts.medium, fontSize: 15 },
  menuNote: { color: world.faint, fontFamily: fonts.regular, fontSize: 12, paddingBottom: 10 },
  list: { paddingHorizontal: 20, paddingBottom: 28 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: world.border, minHeight: 78 },
  rowTitle: { color: world.text, fontFamily: fonts.bold, fontSize: 16 },
  rowMeta: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  eventDot: { width: 52, height: 52, borderRadius: 26, backgroundColor: world.soft, alignItems: "center", justifyContent: "center" },
  more: { alignItems: "center", justifyContent: "center", minHeight: 56 },
  moreText: { color: world.purple, fontFamily: fonts.bold, fontSize: 16 }
});

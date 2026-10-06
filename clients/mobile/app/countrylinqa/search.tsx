import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { ChipPicker, CountryList, FieldRow, RegionList, TextField, ToggleRow, listSummary } from "../../components/countrylinqa/SearchUI";
import { Spinner, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import type { CountryLinqaCatalog } from "../../services/countrylinqa.service";
import { INTEREST_OPTIONS, LANGUAGE_OPTIONS, decodeSearch, emptySearch, encodeSearch, type SearchKind, type SearchState } from "../../services/countrylinqa-search";
import { fonts } from "../../theme/tokens";

const KINDS: Array<{ key: SearchKind; label: string }> = [{ key: "people", label: "People" }, { key: "businesses", label: "Businesses" }, { key: "events", label: "Events" }];
type Open = "country" | "region" | "interests" | "languages" | null;

/** 4.1 Advanced Search. Filters only narrow what your discovery settings already allow. */
export default function CountryLinqaAdvancedSearch() {
  const router = useRouter();
  const client = useCountryClient();
  const params = useLocalSearchParams<{ kind?: string; state?: string }>();
  const [state, setState] = useState<SearchState>(() => decodeSearch(params.state, params.kind === "businesses" || params.kind === "events" ? params.kind : "people"));
  const [catalog, setCatalog] = useState<CountryLinqaCatalog | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.catalog().then((c) => { if (active) setCatalog(c); }, (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load countries"); });
    return () => { active = false; };
  }, [client]);

  const set = (patch: Partial<SearchState>) => setState((old) => ({ ...old, ...patch }));
  const toggle = (which: Exclude<Open, null>) => setOpen((old) => (old === which ? null : which));
  const countryName = state.country ? catalog?.countries.find((c) => c.code === state.country)?.name ?? state.country : "Any";
  const regionName = state.region ? catalog?.regions.find((r) => r.code === state.region)?.name ?? state.region : "Any";
  const people = state.kind === "people";

  return (
    <WorldScreen>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.iconBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace("/countrylinqa/world"))}><Ionicons name="chevron-back" size={26} color={world.text} /></Pressable>
        <Text accessibilityRole="header" style={s.title}>Advanced Search</Text>
        <Pressable accessibilityRole="button" style={s.iconBtn} onPress={() => { setState(emptySearch(state.kind)); setOpen(null); }}><Text style={s.reset}>Reset</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.tabs} accessibilityRole="tablist">
          {KINDS.map((k) => (
            <Pressable key={k.key} accessibilityRole="tab" accessibilityState={{ selected: state.kind === k.key }} style={[s.tab, state.kind === k.key && s.tabOn]} onPress={() => { set({ kind: k.key }); setOpen(null); }}>
              <Text style={[s.tabText, state.kind === k.key && { color: "#FFFFFF" }]}>{k.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.search}><Ionicons name="search" size={18} color={world.faint} /><TextInput accessibilityLabel="Search" value={state.query} onChangeText={(query) => set({ query })} placeholder={people ? "Name" : state.kind === "events" ? "Event title" : "Business name"} placeholderTextColor={world.faint} style={s.searchInput} /></View>

        {!catalog && !error ? <Spinner /> : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
        {catalog ? (
          <>
            <FieldRow label="Country" value={countryName} open={open === "country"} onToggle={() => toggle("country")}><CountryList catalog={catalog} value={state.country} onPick={(country) => { set({ country }); setOpen(null); }} /></FieldRow>
            <FieldRow label="Region" value={regionName} open={open === "region"} onToggle={() => toggle("region")}><RegionList catalog={catalog} value={state.region} onPick={(region) => { set({ region }); setOpen(null); }} /></FieldRow>
            {people ? (
              <>
                <TextField label="City" value={state.city} onChange={(city) => set({ city })} placeholder="Select city" />
                <FieldRow label="Interests" value={listSummary(state.interests)} open={open === "interests"} onToggle={() => toggle("interests")}><ChipPicker options={INTEREST_OPTIONS} value={state.interests} onChange={(interests) => set({ interests })} /></FieldRow>
                <FieldRow label="Language" value={listSummary(state.languages)} open={open === "languages"} onToggle={() => toggle("languages")}><ChipPicker options={LANGUAGE_OPTIONS} value={state.languages} onChange={(languages) => set({ languages })} /></FieldRow>
                <TextField label="Profession" value={state.profession} onChange={(profession) => set({ profession })} placeholder="Select" />
                <ToggleRow label="Verified Profiles Only" value={state.verifiedOnly} onChange={(verifiedOnly) => set({ verifiedOnly })} />
              </>
            ) : state.kind === "businesses" ? (
              <TextField label="Category" value={state.category} onChange={(category) => set({ category: category.trim().toLowerCase() })} placeholder="For example, restaurant" />
            ) : null}
          </>
        ) : null}
        <Text style={s.fine}>Results stay inside your discovery reach. Someone outside it never appears, whatever you filter by.</Text>
      </ScrollView>
      <View style={s.footer}>
        <Pressable accessibilityRole="button" style={s.primary} onPress={() => router.push({ pathname: "/countrylinqa/search-results", params: { state: encodeSearch(state) } })}><Text style={s.primaryText}>Search</Text></Pressable>
      </View>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: 8, minHeight: 56 },
  iconBtn: { minWidth: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: world.text, fontFamily: fonts.extrabold, fontSize: 18 },
  reset: { color: world.purple, fontFamily: fonts.semibold, fontSize: 15 },
  content: { paddingHorizontal: 20, paddingBottom: 20 },
  tabs: { flexDirection: "row", gap: 8, marginTop: 6, marginBottom: 12 },
  tab: { flex: 1, minHeight: 42, borderRadius: 21, backgroundColor: "#EEF0FF", alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: world.purple },
  tabText: { color: world.purple, fontFamily: fonts.semibold, fontSize: 14 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 50, borderRadius: 12, backgroundColor: "#F5F6FB", paddingHorizontal: 14, marginBottom: 8 },
  searchInput: { flex: 1, color: world.text, fontFamily: fonts.regular, fontSize: 15 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14 },
  fine: { color: world.faint, fontFamily: fonts.regular, fontSize: 12, textAlign: "center", marginTop: 12 },
  footer: { paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8 },
  primary: { height: 54, borderRadius: 14, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 17 }
});

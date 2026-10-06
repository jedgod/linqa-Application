import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChipPicker, FieldRow, TextField, ToggleRow, listSummary } from "../../components/countrylinqa/SearchUI";
import { WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { INTEREST_OPTIONS, LANGUAGE_OPTIONS, SORTS, decodeSearch, emptySearch, setPendingSearch, type SearchState } from "../../services/countrylinqa-search";
import { fonts } from "../../theme/tokens";

type Open = "sort" | "interests" | "languages" | null;

/** 4.3 Filters: refine the search you are looking at. Apply goes back to the results with the new filters. */
export default function CountryLinqaSearchFilters() {
  const router = useRouter();
  const params = useLocalSearchParams<{ state?: string }>();
  const [state, setState] = useState<SearchState>(() => decodeSearch(params.state));
  const [open, setOpen] = useState<Open>(null);
  const toggle = (w: Exclude<Open, null>) => setOpen((o) => (o === w ? null : w));
  const set = (patch: Partial<SearchState>) => setState((old) => ({ ...old, ...patch }));
  const people = state.kind === "people";

  function apply() { setPendingSearch(state); router.back(); }
  function reset() { setState({ ...emptySearch(state.kind), country: state.country, region: state.region, query: state.query }); setOpen(null); }

  return (
    <WorldScreen>
      <View style={s.header}>
        <Pressable accessibilityRole="button" style={s.side} onPress={reset}><Text style={s.link}>Reset</Text></Pressable>
        <Text accessibilityRole="header" style={s.title}>Filters</Text>
        <Pressable accessibilityRole="button" style={s.side} onPress={apply}><Text style={[s.link, { textAlign: "right" }]}>Apply</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <FieldRow label="Sort by" value={SORTS.find((x) => x.key === state.sort)!.label} open={open === "sort"} onToggle={() => toggle("sort")}>
          {SORTS.map((o) => (
            <Pressable key={o.key} accessibilityRole="radio" accessibilityState={{ selected: state.sort === o.key }} style={s.option} onPress={() => { set({ sort: o.key }); setOpen(null); }}>
              <Text style={s.optionText}>{o.label}</Text>{state.sort === o.key ? <Ionicons name="checkmark" size={18} color={world.purple} /> : null}
            </Pressable>
          ))}
        </FieldRow>
        {people ? (
          <>
            <FieldRow label="Interests" value={listSummary(state.interests)} open={open === "interests"} onToggle={() => toggle("interests")}><ChipPicker options={INTEREST_OPTIONS} value={state.interests} onChange={(interests) => set({ interests })} /></FieldRow>
            <FieldRow label="Language" value={listSummary(state.languages)} open={open === "languages"} onToggle={() => toggle("languages")}><ChipPicker options={LANGUAGE_OPTIONS} value={state.languages} onChange={(languages) => set({ languages })} /></FieldRow>
            <TextField label="Profession" value={state.profession} onChange={(profession) => set({ profession })} placeholder="Select" />
            <TextField label="City" value={state.city} onChange={(city) => set({ city })} placeholder="Select city" />
            <ToggleRow label="Verified Profiles Only" value={state.verifiedOnly} onChange={(verifiedOnly) => set({ verifiedOnly })} />
          </>
        ) : state.kind === "businesses" ? (
          <TextField label="Category" value={state.category} onChange={(category) => set({ category: category.trim().toLowerCase() })} placeholder="For example, restaurant" />
        ) : <Text style={s.fine}>Events can be narrowed by country and region on the search screen.</Text>}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 8, minHeight: 56 },
  side: { width: 80, minHeight: 44, justifyContent: "center" },
  link: { color: world.purple, fontFamily: fonts.semibold, fontSize: 16 },
  title: { flex: 1, textAlign: "center", color: world.text, fontFamily: fonts.extrabold, fontSize: 18 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 },
  option: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  optionText: { flex: 1, color: world.text, fontFamily: fonts.regular, fontSize: 15 },
  fine: { color: world.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 12 }
});

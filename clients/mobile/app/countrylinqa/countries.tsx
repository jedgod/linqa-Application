import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import type { CountryLinqaCatalog, CountryLinqaPreferences } from "../../services/countrylinqa.service";
import { filterCountries, flagOf, type WorldCountries } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

/** 3.4 Countries: your country, the popular ones within your reach, and regions. Tapping one opens its people. */
export default function CountryLinqaCountries() {
  const router = useRouter();
  const client = useCountryClient();
  const [data, setData] = useState<WorldCountries | null>(null);
  const [prefs, setPrefs] = useState<CountryLinqaPreferences | null>(null);
  const [catalog, setCatalog] = useState<CountryLinqaCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    Promise.all([client.worldCountries(), client.preferences(), client.catalog()]).then(
      ([countries, preferences, cat]) => { if (active) { setData(countries); setPrefs(preferences); setCatalog(cat); } },
      (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load countries"); }
    );
    return () => { active = false; };
  }, [client, reload]));

  const results = useMemo(() => (catalog && query.trim() ? filterCountries(catalog, query, prefs?.verifiedCountryCode ?? null) : []), [catalog, query, prefs?.verifiedCountryCode]);

  function open(code: string, name: string) {
    // The hub explains itself when a country is outside reach, so every country can be opened.
    setNote(null);
    router.push({ pathname: "/countrylinqa/country", params: { code } });
  }

  const row = (key: string, left: string, name: string, onPress: () => void, detail?: string) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${name}${detail ? `, ${detail}` : ""}`} style={s.row} onPress={onPress}>
      <Text style={s.flag}>{left}</Text><Text style={s.name}>{name}</Text>{detail ? <Text style={s.detail}>{detail}</Text> : null}<Ionicons name="chevron-forward" size={18} color={world.faint} />
    </Pressable>
  );

  return (
    <WorldScreen>
      <WorldHeader title="Countries" back />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.search}><Ionicons name="search" size={18} color={world.faint} /><TextInput accessibilityLabel="Search countries" value={query} onChangeText={setQuery} placeholder="Search countries" placeholderTextColor={world.faint} style={s.searchInput} /></View>
        {note ? <View style={s.note}><Text style={s.noteText} accessibilityLiveRegion="polite">{note}</Text><Pressable accessibilityRole="button" onPress={() => router.push("/settings/countrylinqa")}><Text style={s.noteLink}>Settings</Text></Pressable></View> : null}
        {error ? <Empty icon="cloud-offline-outline" title="Can not load countries" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
        {!data && !error ? <Spinner /> : null}

        {data && query.trim() ? (
          <>
            <Text style={s.section}>Results</Text>
            {results.length ? results.slice(0, 60).map((c) => row(c.code, flagOf(c.code), c.name, () => open(c.code, c.name))) : <Text style={s.muted}>No countries match.</Text>}
          </>
        ) : null}

        {data && !query.trim() ? (
          <>
            <Text style={s.section}>Your Country</Text>
            {data.yours ? row(data.yours.code, flagOf(data.yours.code), data.yours.name, () => open(data.yours!.code, data.yours!.name)) : <Pressable accessibilityRole="button" style={s.confirm} onPress={() => router.push("/onboarding/resolve")}><Text style={s.confirmText}>Confirm your country to see it here</Text></Pressable>}

            <Text style={s.section}>Popular Countries</Text>
            {data.popular.length ? data.popular.map((c) => row(c.code, flagOf(c.code), c.name, () => open(c.code, c.name), `${c.members} ${c.members === 1 ? "person" : "people"}`)) : <Text style={s.muted}>No other countries are within your discovery reach yet.</Text>}

            <Text style={s.section}>Regions</Text>
            {data.regions.length ? data.regions.map((r) => (
              <Pressable key={r.code} accessibilityRole="button" accessibilityLabel={`${r.name}, ${r.members} people`} style={s.row} onPress={() => router.push({ pathname: "/countrylinqa/people", params: { region: r.code, title: r.name } })}>
                <View style={s.regionIcon}><Ionicons name="earth" size={18} color={world.purple} /></View><Text style={s.name}>{r.name}</Text><Text style={s.detail}>{r.members}</Text><Ionicons name="chevron-forward" size={18} color={world.faint} />
              </Pressable>
            )) : <Text style={s.muted}>No regions within your discovery reach yet.</Text>}
          </>
        ) : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 30 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: world.border, paddingHorizontal: 14, marginTop: 4 },
  searchInput: { flex: 1, color: world.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 8 },
  section: { color: world.purple, fontFamily: fonts.bold, fontSize: 16, marginTop: 22, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56, borderBottomWidth: 1, borderBottomColor: world.border },
  flag: { fontSize: 28, width: 40, textAlign: "center" },
  regionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: world.soft, alignItems: "center", justifyContent: "center" },
  name: { flex: 1, color: world.text, fontFamily: fonts.semibold, fontSize: 16 },
  detail: { color: world.muted, fontFamily: fonts.regular, fontSize: 13 },
  muted: { color: world.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, paddingVertical: 8 },
  note: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF6E5", borderRadius: 12, padding: 12, marginTop: 12 },
  noteText: { flex: 1, color: "#7A4B00", fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
  noteLink: { color: world.purple, fontFamily: fonts.bold, fontSize: 13 },
  confirm: { minHeight: 52, borderRadius: 12, backgroundColor: world.soft, alignItems: "center", justifyContent: "center" },
  confirmText: { color: world.purple, fontFamily: fonts.semibold, fontSize: 15 }
});

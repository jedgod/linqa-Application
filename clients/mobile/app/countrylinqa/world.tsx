import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Chip, Empty, IconBtn, PersonRow, Spinner, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import type { CountryLinqaPreferences } from "../../services/countrylinqa.service";
import { emptySearch, encodeSearch } from "../../services/countrylinqa-search";
import { flagOf, joinPeople, titleCase, type PersonDetail, type WorldHome } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

const TILES: Array<{ key: string; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; route: { pathname: string; params?: Record<string, string> } }> = [
  { key: "people", label: "People", icon: "people", color: "#2F7BEA", route: { pathname: "/countrylinqa/people" } },
  { key: "countries", label: "Countries", icon: "business", color: "#5B3FE0", route: { pathname: "/countrylinqa/countries" } },
  { key: "communities", label: "Communities", icon: "chatbubbles", color: "#12A58C", route: { pathname: "/countrylinqa/communities" } },
  { key: "events", label: "Events", icon: "sparkles", color: "#F59E0B", route: { pathname: "/countrylinqa/events" } },
  { key: "businesses", label: "Businesses", icon: "storefront", color: "#EA580C", route: { pathname: "/countrylinqa/businesses" } }
];
const SETTINGS: Array<{ label: string; icon: keyof typeof Ionicons.glyphMap; route: string }> = [
  { label: "CountryLinqa settings", icon: "options-outline", route: "/settings/countrylinqa" },
  { label: "My discovery profile", icon: "person-circle-outline", route: "/countrylinqa/discovery-profile" },
  { label: "Connections", icon: "link-outline", route: "/countrylinqa/connections" },
  { label: "Saved searches", icon: "bookmark-outline", route: "/countrylinqa/saved-searches" },
  { label: "Security and privacy", icon: "shield-checkmark-outline", route: "/countrylinqa/security" }
];

/** 3.1 World Home: where you are exploring, quick ways in, what is popular, and people you may know. */
export default function CountryLinqaWorldHome() {
  const router = useRouter();
  const client = useCountryClient();
  const [prefs, setPrefs] = useState<CountryLinqaPreferences | null>(null);
  const [home, setHome] = useState<WorldHome | null>(null);
  const [people, setPeople] = useState<Array<{ id: string; detail: PersonDetail }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    (async () => {
      const [preferences, worldHome] = await Promise.all([client.preferences(), client.worldHome()]);
      if (!active) return;
      setPrefs(preferences); setHome(worldHome);
      // "People you may know" is a bonus; the page still works if it can not be loaded.
      try {
        const recommended = await client.recommendedPeople();
        const details = await client.peopleDetails(recommended.items.slice(0, 6).map((p) => p.id));
        if (active) setPeople(joinPeople(recommended.items, details).slice(0, 3));
      } catch { if (active) setPeople([]); }
    })().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load Linqa World"); });
    return () => { active = false; };
  }, [client, reload]));

  // First time here: walk through setup once. There is no separate registration.
  if (prefs && !prefs.activated) return <Redirect href="/countrylinqa/activate" />;

  const country = home?.country;
  function search() {
    const q = query.trim();
    if (q) router.push({ pathname: "/countrylinqa/search", params: { state: encodeSearch({ ...emptySearch("people"), query: q }) } });
  }

  return (
    <WorldScreen>
      <View style={s.top}>
        <View style={s.logo}><Ionicons name="earth" size={20} color="#FFFFFF" /></View>
        <Text accessibilityRole="header" style={s.brand}>Linqa World</Text>
        <IconBtn icon="search" label="Search" onPress={() => router.push("/countrylinqa/search")} />
        <IconBtn icon="notifications-outline" label="Notifications" onPress={() => router.push("/countrylinqa/notifications")} />
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {error ? <Empty icon="cloud-offline-outline" title="Can not load Linqa World" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
        {!home && !error ? <Spinner /> : null}

        {home ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel={`Exploring ${country?.name ?? "no country yet"}. Change`} style={s.country} onPress={() => router.push("/countrylinqa/countries")}>
              <Text style={s.flag}>{country ? flagOf(country.code) : "🌐"}</Text>
              <Text style={s.countryName}>{country?.name ?? "Choose your country"}</Text>
              <Ionicons name="chevron-down" size={16} color={world.muted} />
            </Pressable>

            {!home.verified ? (
              <Pressable accessibilityRole="button" style={s.banner} onPress={() => router.push("/onboarding/resolve")}>
                <Ionicons name="shield-checkmark-outline" size={20} color={world.purple} />
                <Text style={s.bannerText}>Confirm your country to start discovering people and communities.</Text>
                <Ionicons name="chevron-forward" size={18} color={world.purple} />
              </Pressable>
            ) : null}

            <View style={s.search}>
              <Ionicons name="search" size={18} color={world.faint} />
              <TextInput accessibilityLabel="Search people, countries, events" value={query} onChangeText={setQuery} onSubmitEditing={search} returnKeyType="search" placeholder="Search people, countries, events..." placeholderTextColor={world.faint} style={s.searchInput} />
            </View>

            <View style={s.tiles}>
              {TILES.map((tile) => (
                <Pressable key={tile.key} accessibilityRole="button" accessibilityLabel={tile.label} style={s.tile} onPress={() => router.push(tile.route as never)}>
                  <View style={[s.tileIcon, { backgroundColor: `${tile.color}22` }]}><Ionicons name={tile.icon} size={26} color={tile.color} /></View>
                  <Text style={s.tileLabel} numberOfLines={1}>{tile.label}</Text>
                </Pressable>
              ))}
            </View>

            {country ? (
              <>
                <Text style={s.section}>Trending in {country.name}</Text>
                {home.trending.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                    {home.trending.map((t) => <Chip key={t.tag} label={`#${titleCase(t.tag)}`} onPress={() => router.push({ pathname: "/countrylinqa/people", params: { interest: t.tag, title: `#${titleCase(t.tag)}` } })} />)}
                  </ScrollView>
                ) : <Text style={s.muted}>Nothing is trending yet. Interests people add to their discovery profile show up here.</Text>}
              </>
            ) : null}

            <View style={s.sectionRow}>
              <Text style={s.section}>People You May Know</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push("/countrylinqa/people")}><Text style={s.link}>See all</Text></Pressable>
            </View>
            {people.length ? people.map(({ id, detail }) => (
              <PersonRow key={id} person={detail} onOpen={() => router.push({ pathname: "/countrylinqa/person", params: { id } })} action={{ label: "View", onPress: () => router.push({ pathname: "/countrylinqa/person", params: { id } }) }} />
            )) : <Text style={s.muted}>{home.verified ? "No suggestions yet. Add interests to your discovery profile to get better ones." : "Suggestions appear once your country is confirmed."}</Text>}

            <Text style={[s.section, { marginTop: 26 }]}>Manage</Text>
            {SETTINGS.map((row) => (
              <Pressable key={row.route} accessibilityRole="button" style={s.settingRow} onPress={() => router.push(row.route as never)}>
                <Ionicons name={row.icon} size={22} color={world.purple} /><Text style={s.settingText}>{row.label}</Text><Ionicons name="chevron-forward" size={18} color={world.faint} />
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  logo: { width: 32, height: 32, borderRadius: 16, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  brand: { flex: 1, color: world.purple, fontFamily: fonts.extrabold, fontSize: 21, marginLeft: 4 },
  content: { paddingHorizontal: 20, paddingBottom: 30 },
  country: { flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start", minHeight: 46, paddingHorizontal: 14, borderRadius: 14, backgroundColor: "#F5F6FB", marginTop: 6 },
  flag: { fontSize: 24 },
  countryName: { color: world.text, fontFamily: fonts.semibold, fontSize: 16 },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: world.soft, borderRadius: 14, padding: 14, marginTop: 14 },
  bannerText: { flex: 1, color: world.text, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: world.border, paddingHorizontal: 14, marginTop: 14 },
  searchInput: { flex: 1, color: world.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 8 },
  tiles: { flexDirection: "row", flexWrap: "wrap", marginTop: 18, rowGap: 14 },
  tile: { width: "25%", alignItems: "center", gap: 6, minHeight: 84 },
  tileIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  tileLabel: { color: world.text, fontFamily: fonts.medium, fontSize: 12 },
  section: { color: world.text, fontFamily: fonts.extrabold, fontSize: 18, marginTop: 22, marginBottom: 12 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  link: { color: world.purple, fontFamily: fonts.semibold, fontSize: 14, marginTop: 10 },
  muted: { color: world.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderBottomWidth: 1, borderBottomColor: world.border },
  settingText: { flex: 1, color: world.text, fontFamily: fonts.medium, fontSize: 15 }
});

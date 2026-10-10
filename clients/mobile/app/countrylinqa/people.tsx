import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, IconBtn, PersonRow, Spinner, CountryMenu, WorldHeader, WorldScreen, useMessage, world } from "../../components/countrylinqa/WorldUI";
import type { PeopleFilters } from "../../services/countrylinqa.contract";
import { PEOPLE_TABS, flagOf, joinPeople, peopleRequest, type PeopleTab, type PersonDetail } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

type Row = { id: string; detail: PersonDetail };

/**
 * 3.2 People Discovery. Tabs narrow what the server already allows (For You, your country, your
 * region, everyone in reach); opening it with a country, region or interest shows that place.
 */
export default function CountryLinqaPeople() {
  const router = useRouter();
  const client = useCountryClient();
  const routeParams = useLocalSearchParams<{ country?: string; region?: string; interest?: string; title?: string }>();
  const params = {
    country: typeof routeParams.country === "string" && /^[a-z]{2}$/i.test(routeParams.country) ? routeParams.country.toUpperCase() : undefined,
    region: typeof routeParams.region === "string" && /^[a-z0-9-]{1,16}$/i.test(routeParams.region) ? routeParams.region.toUpperCase() : undefined,
    interest: typeof routeParams.interest === "string" && /^[a-z0-9 _-]{1,80}$/i.test(routeParams.interest) ? routeParams.interest : undefined
  };
  const place = !!(params.country || params.region || params.interest);
  const [placeName, setPlaceName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setPlaceName(null);
    void client.catalog().then(catalog => {
      const label = catalog.countries.find(country => country.code === params.country)?.name
        ?? catalog.regions.find(region => region.code === params.region)?.name;
      if (live) setPlaceName(label ?? null);
    }).catch(() => {});
    return () => { live = false; };
  }, [client, params.country, params.region]);
  const [tab, setTab] = useState<PeopleTab>("FOR_YOU");
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const [me, setMe] = useState<{ country: string | null; countryName: string | null; region: string | null } | null>(null);
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const generation = useRef(0);
  const chat = useMessage((conversationId) => router.push({ pathname: "/modules/conversation", params: { conversationId } }));

  useEffect(() => { const t = setTimeout(() => setTerm(query.trim()), 350); return () => clearTimeout(t); }, [query]);

  const load = useCallback(async (more: boolean) => {
    const mine = more ? generation.current : ++generation.current;
    setLoading(true); setError(null);
    if (!more) { setRows([]); setCursor(null); setEmpty(null); }
    try {
      let context = me;
      if (!context) {
        const [prefs, catalog] = await Promise.all([client.preferences(), client.catalog()]);
        const country = catalog.countries.find((c) => c.code === prefs.verifiedCountryCode);
        context = { country: prefs.verifiedCountryCode, countryName: country?.name ?? null, region: country?.regionCode ?? null };
        if (mine === generation.current) setMe(context);
      }
      const extra: PeopleFilters = { ...(term ? { query: term } : {}), ...(params.interest ? { interests: [params.interest] } : {}) };
      const request = place
        ? { kind: "SEARCH" as const, filters: { ...extra, ...(params.country ? { countries: [params.country] } : {}), ...(params.region ? { region: params.region } : {}) } }
        : peopleRequest(tab, context, extra);
      if (request.kind === "EMPTY") { if (mine === generation.current) setEmpty(request.reason); return; }
      const page = request.kind === "RECOMMENDED"
        ? { items: (await client.recommendedPeople()).items, nextCursor: null as string | null }
        : await client.searchPeople(request.filters, { limit: 20, ...(more && cursor ? { cursor } : {}) });
      const details = await client.peopleDetails(page.items.map((p) => p.id));
      if (mine !== generation.current) return;
      const next = joinPeople(page.items, details);
      setRows((old) => (more ? [...old, ...next.filter((n) => !old.some((o) => o.id === n.id))] : next));
      setCursor(page.nextCursor);
    } catch (cause) {
      if (mine === generation.current) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to load people");
    } finally { if (mine === generation.current) setLoading(false); }
  }, [client, me, tab, term, place, params.country, params.region, params.interest, cursor]);

  // Reload when the tab, the search or the place changes. `load` itself changes with its inputs, so it is not a dependency here.
  useFocusEffect(useCallback(() => { void load(false); return () => { generation.current++; }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, term, params.country, params.region, params.interest, client]));

  const title = "People";
  const subtitle = place ? undefined : me?.countryName ?? undefined;
  return (
    <WorldScreen>
      <WorldHeader title={title} {...(subtitle ? { subtitle } : {})} {...(subtitle ? { onSubtitle: () => setMenu((v) => !v), subtitleOpen: menu } : {})} back={place}
        right={<><IconBtn icon={searching ? "close" : "search"} label={searching ? "Close search" : "Search people"} onPress={() => { setSearching((v) => !v); setQuery(""); }} /><IconBtn icon="person-add-outline" label="Connection requests" onPress={() => router.push("/countrylinqa/connections")} /></>} />
      <CountryMenu open={menu} onClose={() => setMenu(false)} target="people" />
      {searching ? (
        <View style={s.search}><Ionicons name="search" size={18} color={world.faint} /><TextInput autoFocus accessibilityLabel="Search people by name" value={query} onChangeText={setQuery} placeholder="Search by name" placeholderTextColor={world.faint} style={s.searchInput} /></View>
      ) : null}
      {!place ? (
        <View style={s.tabs} accessibilityRole="tablist">
          {PEOPLE_TABS.map((t) => (
            <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }} style={[s.tab, tab === t.key && s.tabOn]} onPress={() => setTab(t.key)}>
              <Text style={[s.tabText, tab === t.key && { color: world.purple, fontFamily: fonts.bold }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={s.place}>{params.country ? `${flagOf(params.country)} ` : ""}{placeName ?? "Selected location"}</Text>
      )}
      <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
        {chat.error ? <View style={s.error}><Text style={s.errorText} accessibilityLiveRegion="polite">{chat.error}</Text></View> : null}
        {error ? <Empty icon="cloud-offline-outline" title="Can not load people" text={error} action={{ label: "Try again", onPress: () => void load(false) }} /> : null}
        {loading && rows.length === 0 ? <Spinner /> : null}
        {rows.map(({ id, detail }) => (
          <PersonRow key={id} person={detail} messaging={chat.busy === id} onMessage={() => chat.message(id, detail.displayName)} onOpen={() => router.push({ pathname: "/countrylinqa/person", params: { id } })} />
        ))}
        {!loading && !error && rows.length === 0 ? (
          <Empty icon="people-outline" title={empty ? "Nothing to show yet" : "No one here yet"} text={empty ?? (tab === "GLOBAL" || place ? "No one matches. People outside your discovery reach never appear here. You can widen it in settings." : "No one matches yet. Try another tab or change your discovery settings.")}
            action={{ label: "Discovery settings", onPress: () => router.push("/settings/countrylinqa") }} />
        ) : null}
        {cursor && !loading ? <Pressable accessibilityRole="button" style={s.more} onPress={() => void load(true)}><Text style={s.moreText}>Load more</Text></Pressable> : null}
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
  place: { paddingHorizontal: 20, paddingVertical: 8, color: world.muted, fontFamily: fonts.medium, fontSize: 14 },
  list: { paddingHorizontal: 20, paddingBottom: 28 },
  error: { backgroundColor: "#FEF3F2", borderRadius: 12, padding: 12, marginTop: 6 },
  errorText: { color: world.danger, fontFamily: fonts.medium, fontSize: 14 },
  more: { alignItems: "center", justifyContent: "center", minHeight: 56 },
  moreText: { color: world.purple, fontFamily: fonts.bold, fontSize: 16 }
});

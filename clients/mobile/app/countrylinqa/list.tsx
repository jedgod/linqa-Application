import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { CountryButton, CountryError, CountryInput, CountryLoading, CountryPage, countryStyles as s, countryTabs, parseCountryFilters, useCountryClient } from "../../components/CountryLinqaUI";
import type { CountryCollection, CountryItem, CountryPagination } from "../../services/countrylinqa.service";

export default function CountryLinqaListScreen() {
  const params = useLocalSearchParams<{ kind?: string; filters?: string }>();
  const kind: CountryCollection = countryTabs.find(tab => tab.kind === params.kind)?.kind ?? "feed";
  const filters = useMemo(() => parseCountryFilters(params.filters), [params.filters]);
  const client = useCountryClient();
  const router = useRouter();
  const [query, setQuery] = useState(filters.q ?? "");
  const [search, setSearch] = useState(query);
  const [period, setPeriod] = useState<"all" | "week" | "month">("all");
  const [mine, setMine] = useState(false);
  const [items, setItems] = useState<CountryItem[]>([]);
  const [page, setPage] = useState<CountryPagination | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => { setQuery(filters.q ?? ""); setSearch(filters.q ?? ""); }, [filters]);
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  const queryKey = JSON.stringify({ ...filters, q: search, period, joinedOnly: kind === "communities" && mine });
  const load = useCallback(async (next?: CountryPagination) => {
    if (next && inFlight.current) return;
    const request = next ? version.current : ++version.current;
    inFlight.current = true; setLoading(true); setError(null);
    if (!next) { setItems([]); setPage(null); }
    try {
      const result = await client.collection(kind, JSON.parse(queryKey), next);
      if (request !== version.current) return;
      setItems(old => next ? [...old, ...result.items.filter(item => !old.some(existing => existing.id === item.id))] : result.items);
      setPage(result.nextCursor ? { cursor: result.nextCursor } : typeof result.nextOffset === "number" ? { offset: result.nextOffset } : null);
    } catch (cause) { if (request === version.current) setError(cause instanceof Error ? cause.message : "Unable to load discovery"); }
    finally { if (request === version.current) { setLoading(false); inFlight.current = false; } }
  }, [client, kind, queryKey]);
  useFocusEffect(useCallback(() => { setBusy(null); void load(); return () => { version.current++; inFlight.current = false; }; }, [load]));
  async function membership(item: CountryItem) {
    if (busy) return;
    const request = version.current;
    setBusy(item.id); setError(null);
    try {
      if (item.joined) await client.leaveCountryCommunity(item.id); else await client.joinCountryCommunity(item.id);
      if (request === version.current) setItems(old => old.map(row => row.id === item.id ? { ...row, joined: !item.joined, memberCount: Math.max(0, (row.memberCount ?? 0) + (item.joined ? -1 : 1)), detail: `${Math.max(0, (row.memberCount ?? 0) + (item.joined ? -1 : 1))} members` } : row));
    } catch (cause) { if (request === version.current) setError(cause instanceof Error ? cause.message : "Unable to update membership"); }
    finally { if (request === version.current) setBusy(null); }
  }
  const visible = mine && kind === "communities" ? items.filter(item => item.joined) : items;
  async function connect(item: CountryItem) {
    if (item.connectionIncoming) { router.push("/countrylinqa/connections"); return; }
    const request = version.current; setBusy(item.id); setError(null);
    try { const result = await client.connect(item.id); if (request === version.current) setItems(old => old.map(row => row.id === item.id ? { ...row, connectionStatus: result.status } : row)); }
    catch (cause) { if (request === version.current) setError(cause instanceof Error ? cause.message : "Unable to connect"); }
    finally { if (request === version.current) setBusy(null); }
  }
  return <CountryPage title={countryTabs.find(tab => tab.kind === kind)?.label ?? "World"} tab={kind} actions={<>
    <Pressable style={s.iconButton} accessibilityLabel="Advanced search" onPress={() => router.push({ pathname: "/countrylinqa/search", params: { kind, filters: params.filters } })}><Ionicons name="options-outline" size={22} color="#6045E8" /></Pressable>
    <Pressable style={s.iconButton} accessibilityLabel="Discovery settings" onPress={() => router.push("/settings/countrylinqa")}><Ionicons name="settings-outline" size={22} color="#6045E8" /></Pressable>
  </>}>
    <CountryInput label={`Search ${kind === "feed" ? "posts" : kind}`} value={query} onChange={setQuery} placeholder="Search in your discovery scope" />
    <Text style={s.copy}>{[filters.country, filters.region, kind === "people" ? filters.language : null].filter(Boolean).join(" · ") || "Your discovery scope"}</Text>
    {kind === "events" && <View style={s.chips}>{(["all", "week", "month"] as const).map(value => <Pressable accessibilityRole="radio" accessibilityState={{ checked: value === period }} style={[s.chip, value === period && { backgroundColor: "#D8CFFF" }]} key={value} onPress={() => setPeriod(value)}><Text style={s.copy}>{value === "all" ? "For you" : value === "week" ? "Next 7 days" : "Next month"}</Text></Pressable>)}</View>}
    {kind === "communities" && <View style={s.row}><Text style={s.copy}>My communities</Text><Switch accessibilityLabel="Show joined communities" value={mine} onValueChange={setMine} /></View>}
    {(kind === "feed" || kind === "events") && <CountryButton label={kind === "events" ? "Create event" : "Create post"} onPress={() => router.push(`/countrylinqa/create?type=${kind === "events" ? "event" : "post"}`)} />}
    <CountryError error={error} retry={() => void load()} />
    {visible.map(item => <View key={item.id} style={s.card}>
      {kind === "people" && <Ionicons name="person-circle-outline" size={40} color="#6045E8" />}
      <Text style={s.cardTitle}>{item.title}</Text>{item.detail ? <Text style={s.copy}>{item.detail}</Text> : null}
      {item.startsAt && <Text style={s.copy}>{new Date(item.startsAt).toLocaleString()}</Text>}
      {item.createdAt && <Text style={s.copy}>{new Date(item.createdAt).toLocaleString()}</Text>}
      {kind === "people" && <CountryButton secondary label={busy === item.id ? "Sending…" : item.connectionStatus === "ACCEPTED" ? "Connected" : item.connectionStatus === "PENDING" ? item.connectionIncoming ? "Respond to request" : "Request sent" : "Connect"} disabled={!!busy || item.connectionStatus === "ACCEPTED" || (item.connectionStatus === "PENDING" && !item.connectionIncoming)} onPress={() => void connect(item)} />}
      {kind === "communities" && <CountryButton secondary label={item.suspended ? "Membership suspended" : busy === item.id ? "Updating…" : item.joined ? "Leave community" : "Join community"} disabled={!!busy || item.suspended} onPress={() => void membership(item)} />}
      {kind !== "communities" && <Pressable accessibilityRole="button" style={s.iconButton} onPress={() => router.push({ pathname: "/countrylinqa/report", params: { subjectId: item.id, subjectType: kind === "people" ? "USER" : kind === "feed" ? "POST" : kind === "events" ? "EVENT" : "BUSINESS" } })}><Text style={s.copy}>Report</Text></Pressable>}
    </View>)}
    {loading && <CountryLoading />}
    {!loading && !error && visible.length === 0 && <View style={s.card}><Text style={s.cardTitle}>No results yet</Text><Text style={s.copy}>Try another search or adjust your discovery settings.</Text></View>}
    {page && <CountryButton secondary disabled={loading} label={loading ? "Loading…" : "Load more"} onPress={() => void load(page)} />}
    {kind === "people" && <CountryButton secondary label="Saved searches" onPress={() => router.push("/countrylinqa/saved-searches")} />}
    {kind === "people" && <CountryButton secondary label="Connection requests" onPress={() => router.push("/countrylinqa/connections")} />}
  </CountryPage>;
}

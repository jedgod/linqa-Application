import { useEffect, useMemo, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CountryButton, CountryError, CountryInput, CountryLoading, CountryPage, CountryPicker, countryStyles as s, parseCountryFilters, useCountryClient } from "../../components/CountryLinqaUI";
import type { CountryCollection, CountryLinqaCatalog, CountrySearch } from "../../services/countrylinqa.service";

export default function CountryLinqaSearch() {
  const params = useLocalSearchParams<{ kind?: string; filters?: string }>();
  const initial = useMemo(() => parseCountryFilters(params.filters), [params.filters]);
  const router = useRouter(); const client = useCountryClient();
  const [kind, setKind] = useState<CountryCollection>(["businesses", "events"].includes(params.kind ?? "") ? params.kind as CountryCollection : "people");
  const [draft, setDraft] = useState<CountrySearch>(initial);
  const [catalog, setCatalog] = useState<CountryLinqaCatalog | null>(null);
  const [countryQuery, setCountryQuery] = useState("");
  const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  useEffect(() => { let current = true; setCatalog(null); setDraft(initial); setError(null); client.catalog().then(value => { if (current) setCatalog(value); }).catch(cause => { if (current) setError(cause.message); }); return () => { current = false; }; }, [client, initial]);
  const filters: CountrySearch = { ...(draft.q ? { q: draft.q.trim() } : {}), ...(draft.country ? { country: draft.country } : {}), ...(draft.region ? { region: draft.region } : {}), ...(kind === "people" ? { verifiedOnly: draft.verifiedOnly ?? true, ...(draft.language ? { language: draft.language.trim() } : {}) } : {}) };
  function update(patch: Partial<CountrySearch>) { setDraft(old => ({ ...old, ...patch })); setSaved(false); }
  async function save() { setBusy(true); setError(null); try { await client.saveSearch(name.trim(), filters); setSaved(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save search"); } finally { setBusy(false); } }
  return <CountryPage title="Advanced Search">
    <Text style={s.copy}>Search within your active CountryLinqa scope. Your privacy and plan settings still apply.</Text>
    <View style={s.chips}>{(["people", "businesses", "events"] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: kind === value }} style={[s.chip, kind === value && { backgroundColor: "#D8CFFF" }]} onPress={() => { setKind(value); setSaved(false); }}><Text style={s.copy}>{value.charAt(0).toUpperCase() + value.slice(1)}</Text></Pressable>)}</View>
    <CountryInput label="Search" value={draft.q ?? ""} onChange={q => update({ q })} placeholder={kind === "people" ? "Name" : kind === "events" ? "Event title" : "Business name"} />
    <CountryInput label="Find a country" value={countryQuery} onChange={setCountryQuery} placeholder="Country name or code" />
    {catalog ? <>
      <CountryPicker label="Country" value={draft.country ?? ""} options={catalog.countries.filter(country => `${country.name} ${country.code}`.toLowerCase().includes(countryQuery.toLowerCase()))} onChange={country => update({ country })} />
      <CountryPicker label="Region" value={draft.region ?? ""} options={catalog.regions} onChange={region => update({ region })} />
    </> : !error && <CountryLoading />}
    {kind === "people" && <>
      <CountryInput label="Language code" value={draft.language ?? ""} onChange={language => update({ language })} placeholder="For example, en" />
      <View style={s.row}><Text style={s.copy}>Verified users only</Text><Switch accessibilityLabel="Verified users only" value={draft.verifiedOnly ?? true} onValueChange={verifiedOnly => update({ verifiedOnly })} /></View>
    </>}
    <CountryError error={error} />
    <CountryButton label="Search" onPress={() => router.push({ pathname: "/countrylinqa/list", params: { kind, filters: JSON.stringify(filters) } })} />
    <CountryButton secondary label="Reset filters" onPress={() => { setDraft({}); setCountryQuery(""); setSaved(false); }} />
    {kind === "people" && <View style={s.card}><Text style={s.cardTitle}>Save this people search</Text><CountryInput label="Search name" value={name} onChange={value => { setName(value); setSaved(false); }} placeholder="People in my country" /><CountryButton secondary label={saved ? "Search saved" : busy ? "Saving…" : "Save search"} disabled={busy || saved || !name.trim()} onPress={() => void save()} /><CountryButton secondary label="Saved searches" onPress={() => router.push("/countrylinqa/saved-searches")} /></View>}
  </CountryPage>;
}

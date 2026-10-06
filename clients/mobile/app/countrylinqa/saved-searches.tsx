import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { CountryButton, CountryError, CountryLoading, CountryPage, countryStyles as s, useCountryClient } from "../../components/CountryLinqaUI";
import type { SavedCountrySearch } from "../../services/countrylinqa.service";

export default function CountryLinqaSavedSearches() {
  const client = useCountryClient(); const router = useRouter();
  const [items, setItems] = useState<SavedCountrySearch[] | null>(null);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useFocusEffect(useCallback(() => { let current = true; setItems(null); setError(null); setBusy(null); client.savedSearches().then(value => { if (current) setItems(value.items); }).catch(cause => { if (current) setError(cause.message); }); return () => { current = false; }; }, [client, reload]));
  async function toggleAlerts(id: string, enabled: boolean) {
    setBusy(id); setError(null);
    try {
      await client.setSavedSearchAlerts(id, enabled);
      setItems(old => old?.map(item => item.id === id ? { ...item, alertsEnabled: enabled } : item) ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to change alerts"); }
    finally { setBusy(null); }
  }
  async function remove(id: string) { setBusy(id); setError(null); try { await client.deleteSavedSearch(id); setItems(old => old?.filter(item => item.id !== id) ?? []); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete search"); } finally { setBusy(null); } }
  return <CountryPage title="Saved Searches">
    <Text style={s.copy}>Run a saved people search with your current discovery permissions.</Text>
    <CountryError error={error} retry={() => setReload(old => old + 1)} />
    {!items && !error && <CountryLoading />}
    {items?.map(item => <View key={item.id} style={s.card}><Text style={s.cardTitle}>{item.name}</Text><Text style={s.copy}>{[item.filters.q, item.filters.country, item.filters.region, item.filters.language].filter(Boolean).join(" · ") || "My discovery scope"}</Text><CountryButton label="Run search" onPress={() => router.push({ pathname: "/countrylinqa/list", params: { kind: "people", filters: JSON.stringify(item.filters) } })} /><CountryButton secondary label={item.alertsEnabled ? "Alerts on" : "Alert me about new people"} disabled={!!busy} onPress={() => void toggleAlerts(item.id, !item.alertsEnabled)} /><CountryButton secondary label={busy === item.id ? "Deleting…" : "Delete"} disabled={!!busy} onPress={() => void remove(item.id)} /></View>)}
    {items?.length === 0 && <Text style={s.copy}>No saved searches yet.</Text>}
    <CountryButton label="Create a search" onPress={() => router.push("/countrylinqa/search")} />
  </CountryPage>;
}

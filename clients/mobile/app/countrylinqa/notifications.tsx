import { useCallback, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { CountryButton, CountryError, CountryLoading, CountryPage, countryStyles as s, useCountryClient } from "../../components/CountryLinqaUI";
import type { CountryNotification, CountryNotificationPreferences } from "../../services/countrylinqa.service";

const toggles = [{ key: "countryTrends", label: "Country trends" }, { key: "regionalTrends", label: "Regional trends" }, { key: "selectedCountryActivity", label: "Selected country activity" }, { key: "countryEvents", label: "Events" }, { key: "countryBusinesses", label: "Business recommendations" }, { key: "securityAlerts", label: "Security alerts" }] as const;
export default function CountryLinqaNotifications() {
  const client = useCountryClient();
  const [prefs, setPrefs] = useState<CountryNotificationPreferences | null>(null);
  const [items, setItems] = useState<CountryNotification[]>([]); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false); const [reload, setReload] = useState(0);
  useFocusEffect(useCallback(() => { let current = true; setPrefs(null); setItems([]); setSaved(false); setError(null); Promise.all([client.notificationPreferences(), client.notifications()]).then(([next, inbox]) => { if (current) { setPrefs(next); setItems(inbox.items); } }).catch(cause => { if (current) setError(cause.message); }); return () => { current = false; }; }, [client, reload]));
  async function save() { if (!prefs) return; setBusy(true); setError(null); try { setPrefs(await client.saveNotificationPreferences(prefs)); setSaved(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save notifications"); } finally { setBusy(false); } }
  return <CountryPage title="CountryLinqa Notifications">
    <CountryError error={error} retry={() => setReload(value => value + 1)} />
    {!prefs && !error && <CountryLoading />}
    {prefs && <View style={s.card}><Text style={s.cardTitle}>Notification preferences</Text>{toggles.map(toggle => <View key={toggle.key} style={s.row}><Text style={s.copy}>{toggle.label}</Text><Switch accessibilityLabel={toggle.label} disabled={busy} value={prefs[toggle.key]} onValueChange={value => { setPrefs({ ...prefs, [toggle.key]: value }); setSaved(false); }} /></View>)}<Text style={s.label}>Digest frequency</Text><View style={s.chips}>{(["OFF", "DAILY", "WEEKLY"] as const).map(value => <Pressable key={value} disabled={busy} style={s.chip} accessibilityRole="radio" accessibilityState={{ checked: prefs.digestFrequency === value }} onPress={() => { setPrefs({ ...prefs, digestFrequency: value }); setSaved(false); }}><Text style={s.copy}>{prefs.digestFrequency === value ? "✓ " : ""}{value}</Text></Pressable>)}</View><CountryButton label={busy ? "Saving…" : saved ? "Preferences saved" : "Save preferences"} disabled={busy || saved} onPress={() => void save()} /></View>}
    <Text style={s.cardTitle}>Recent delivered alerts</Text>
    {items.map(item => <View key={item.id} style={s.card}><Text style={s.cardTitle}>{String(item.payload.title ?? item.notificationType).replace(/_/g, " ")}</Text>{typeof item.payload.body === "string" && <Text style={s.copy}>{item.payload.body}</Text>}<Text style={s.copy}>{new Date(item.createdAt).toLocaleString()}</Text></View>)}
    {prefs && items.length === 0 && <Text style={s.copy}>No delivered CountryLinqa alerts yet.</Text>}
  </CountryPage>;
}

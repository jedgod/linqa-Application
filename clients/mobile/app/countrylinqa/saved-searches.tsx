import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import type { SavedCountrySearch } from "../../services/countrylinqa.service";
import { describeSearch, encodeSearch, fromSavedFilters, lastUsedLabel } from "../../services/countrylinqa-search";
import { fonts } from "../../theme/tokens";

/** 4.4 Saved Searches: tap one to run it again with your current discovery permissions. */
export default function CountryLinqaSavedSearches() {
  const client = useCountryClient();
  const router = useRouter();
  const [items, setItems] = useState<SavedCountrySearch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    client.savedSearches().then((v) => { if (active) setItems(v.items); }, (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load saved searches"); });
    return () => { active = false; };
  }, [client, reload]));

  async function run(item: SavedCountrySearch) {
    // Recording the use is a courtesy; the search runs even if it fails.
    void client.markSavedSearchUsed(item.id).catch(() => undefined);
    router.push({ pathname: "/countrylinqa/search-results", params: { state: encodeSearch(fromSavedFilters(item.filters)) } });
  }
  async function alerts(item: SavedCountrySearch) {
    if (busy) return;
    setBusy(item.id); setError(null);
    const next = !item.alertsEnabled;
    try { await client.setSavedSearchAlerts(item.id, next); setItems((old) => old?.map((i) => (i.id === item.id ? { ...i, alertsEnabled: next } : i)) ?? []); }
    catch { setError("Unable to change alerts. Try again."); }
    finally { setBusy(null); }
  }
  function remove(item: SavedCountrySearch) {
    Alert.alert(`Delete "${item.name}"?`, "This only removes the saved search.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        setBusy(item.id); setError(null);
        try { await client.deleteSavedSearch(item.id); setItems((old) => old?.filter((i) => i.id !== item.id) ?? []); }
        catch { setError("Unable to delete. Try again."); }
        finally { setBusy(null); }
      } }
    ]);
  }

  return (
    <WorldScreen>
      <WorldHeader title="Saved Searches" back />
      <ScrollView contentContainerStyle={s.list}>
        {error ? <Empty icon="cloud-offline-outline" title="Something went wrong" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
        {!items && !error ? <Spinner /> : null}
        {items?.map((item) => (
          <View key={item.id} style={s.card}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}. ${lastUsedLabel(item.lastUsedAt ?? null)}. Run this search`} style={s.main} onPress={() => void run(item)}>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{item.name}</Text>
                <Text style={s.meta}>{lastUsedLabel(item.lastUsedAt ?? null)}</Text>
                <Text style={s.desc} numberOfLines={1}>{describeSearch(fromSavedFilters(item.filters))}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={world.faint} />
            </Pressable>
            <View style={s.actions}>
              <Pressable accessibilityRole="switch" accessibilityState={{ checked: !!item.alertsEnabled, disabled: busy === item.id }} accessibilityLabel={`Alerts for ${item.name}`} style={s.action} onPress={() => void alerts(item)}>
                <Ionicons name={item.alertsEnabled ? "notifications" : "notifications-outline"} size={17} color={world.purple} /><Text style={s.actionText}>{item.alertsEnabled ? "Alerts on" : "Alerts off"}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`} style={s.action} onPress={() => remove(item)}><Ionicons name="trash-outline" size={17} color={world.danger} /><Text style={[s.actionText, { color: world.danger }]}>Delete</Text></Pressable>
            </View>
          </View>
        ))}
        {items?.length === 0 ? <Empty icon="bookmark-outline" title="No saved searches yet" text="Run a people search and tap the bookmark to save it." action={{ label: "Start a search", onPress: () => router.push("/countrylinqa/search") }} /> : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 28, gap: 12, paddingTop: 6 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: world.border, backgroundColor: "#FFFFFF" },
  main: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, minHeight: 72 },
  name: { color: world.text, fontFamily: fonts.bold, fontSize: 17 },
  meta: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  desc: { color: world.faint, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  actions: { flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingBottom: 6 },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 10 },
  actionText: { color: world.purple, fontFamily: fonts.medium, fontSize: 13 }
});

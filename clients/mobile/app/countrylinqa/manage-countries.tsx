import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import type { CountryLinqaCatalog, CountryLinqaPreferences } from "../../services/countrylinqa.service";
import { discoveredCountries, reachSummaries, savePayload } from "../../services/countrylinqa-settings";
import { flagOf } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

/** 5.2 Manage Countries: the countries you discover (add or remove), and who can discover or chat with you. */
export default function CountryLinqaManageCountries() {
  const router = useRouter();
  const client = useCountryClient();
  const [prefs, setPrefs] = useState<CountryLinqaPreferences | null>(null);
  const [catalog, setCatalog] = useState<CountryLinqaCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    Promise.all([client.preferences(), client.catalog()]).then(
      ([p, c]) => { if (active) { setPrefs(p); setCatalog(c); } },
      (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load countries"); }
    );
    return () => { active = false; };
  }, [client, reload]));

  async function remove(code: string, name: string) {
    if (!prefs || busy) return;
    const left = prefs.selectedCountries.filter((c) => c !== code);
    setBusy(true); setError(null);
    try {
      // With no chosen country left, discovery goes back to your own country.
      setPrefs(await client.savePreferences(savePayload(prefs, left.length ? { selectedCountries: left } : { mode: "MY_COUNTRY", selectedCountries: [] })));
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "PREFERENCE_VERSION_CONFLICT" ? "Your settings changed on another device. Reloaded; try again." : `Unable to remove ${name}.`);
      setReload((n) => n + 1);
    } finally { setBusy(false); }
  }
  const confirmRemove = (code: string, name: string) => Alert.alert(`Remove ${name}?`, "You will stop discovering people, events and businesses from there.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => void remove(code, name) }]);

  const sums = prefs && catalog ? reachSummaries(prefs, catalog) : null;
  const nameOf = (code: string) => catalog?.countries.find((c) => c.code === code)?.name ?? code;

  return (
    <WorldScreen>
      <WorldHeader title="Manage Countries" back />
      <ScrollView contentContainerStyle={s.content}>
        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        {!prefs && !error ? <Spinner /> : null}
        {prefs && catalog && sums ? (
          <>
            <Text style={s.section}>Countries I Discover</Text>
            {prefs.mode === "REGION" || prefs.mode === "GLOBAL" ? (
              <View style={s.row}><Ionicons name="earth" size={26} color={world.purple} /><View style={{ flex: 1 }}><Text style={s.name}>{sums.discover}</Text><Text style={s.meta}>{prefs.mode === "GLOBAL" ? "Every country within your plan" : "By region"}</Text></View></View>
            ) : null}
            {prefs.mode !== "REGION" && prefs.mode !== "GLOBAL" ? discoveredCountries(prefs).map((code) => {
              const own = code === prefs.verifiedCountryCode;
              return (
                <View key={code} style={s.row}>
                  <Text style={s.flag}>{flagOf(code)}</Text>
                  <View style={{ flex: 1 }}><Text style={s.name}>{nameOf(code)}</Text>{own ? <Text style={s.meta}>Your country</Text> : null}</View>
                  {own ? null : <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${nameOf(code)}`} disabled={busy} style={s.remove} onPress={() => confirmRemove(code, nameOf(code))}><Ionicons name="close-circle-outline" size={24} color={world.faint} /></Pressable>}
                </View>
              );
            }) : null}
            <Pressable accessibilityRole="button" style={s.add} onPress={() => router.push({ pathname: "/settings/countrylinqa-reach", params: { view: "ADD_COUNTRY" } })}>
              <Ionicons name="add" size={20} color={world.purple} /><Text style={s.addText}>Add Country</Text>
              {!prefs.allowedModes.SELECTED_COUNTRIES ? <Text style={s.tier}>PREMIUM</Text> : null}
            </Pressable>

            <Text style={s.section}>People Who Can Discover Me</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`People who can discover me, ${sums.discoverMe}`} style={s.row} onPress={() => router.push("/settings/countrylinqa-reach")}>
              <Ionicons name="eye-outline" size={24} color={world.purple} /><Text style={[s.name, { flex: 1 }]}>{sums.discoverMe}</Text><Ionicons name="chevron-forward" size={18} color={world.faint} />
            </Pressable>

            <Text style={s.section}>People Who Can Chat Me</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`People who can chat me, ${sums.chatMe}`} style={s.row} onPress={() => router.push("/settings/countrylinqa-reach")}>
              <Ionicons name="chatbubble-ellipses-outline" size={24} color={world.purple} /><Text style={[s.name, { flex: 1 }]}>{sums.chatMe}</Text><Ionicons name="chevron-forward" size={18} color={world.faint} />
            </Pressable>
            <Text style={s.fine}>Chat reach only applies to starting a new chat. Existing conversations are not affected.</Text>
          </>
        ) : null}
        {!prefs && error ? <Empty icon="cloud-offline-outline" title="Can not load countries" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 30 },
  section: { color: world.purple, fontFamily: fonts.bold, fontSize: 16, marginTop: 18, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 58, borderBottomWidth: 1, borderBottomColor: world.border },
  flag: { fontSize: 30, width: 40, textAlign: "center" },
  name: { color: world.text, fontFamily: fonts.semibold, fontSize: 16 },
  meta: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  add: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 54 },
  addText: { color: world.purple, fontFamily: fonts.semibold, fontSize: 16, flex: 1 },
  tier: { color: "#B54708", fontFamily: fonts.bold, fontSize: 11 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 10 },
  fine: { color: world.faint, fontFamily: fonts.regular, fontSize: 12, marginTop: 10 }
});

import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import type { CountryLinqaPreferences } from "../../services/countrylinqa.service";
import { savePayload, type SaveOverrides } from "../../services/countrylinqa-settings";
import { fonts } from "../../theme/tokens";

type Key = "verifiedOnly" | "allowBusinesses" | "allowCommunities" | "allowEvents" | "paused";
const TOGGLES: Array<{ key: Key; label: string; hint: string }> = [
  { key: "verifiedOnly", label: "Verified Profiles Only", hint: "Only suggest people with a verified country." },
  { key: "allowBusinesses", label: "Businesses", hint: "Show businesses in your discovery." },
  { key: "allowCommunities", label: "Communities", hint: "Show country communities." },
  { key: "allowEvents", label: "Events", hint: "Show events." },
  { key: "paused", label: "Pause Discovery", hint: "Stop new discovery. Contacts and chats stay." }
];

/** 5.3 More Settings. Each switch saves as you flip it, and flips back if the save fails. */
export default function CountryLinqaMoreSettings() {
  const router = useRouter();
  const client = useCountryClient();
  const [prefs, setPrefs] = useState<CountryLinqaPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Key | null>(null);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    client.preferences().then((p) => { if (active) setPrefs(p); }, (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load settings"); });
    return () => { active = false; };
  }, [client, reload]));

  async function flip(key: Key, value: boolean) {
    if (!prefs || busy) return;
    const before = prefs;
    setBusy(key); setError(null);
    setPrefs({ ...prefs, [key]: value });
    try {
      setPrefs(await client.savePreferences(savePayload(before, { [key]: value } as SaveOverrides)));
    } catch (cause) {
      setPrefs(before);
      if (cause instanceof Error && cause.message === "PREFERENCE_VERSION_CONFLICT") { setError("Your settings changed on another device. Reloaded; try again."); setReload((n) => n + 1); }
      else setError("Unable to save. Try again.");
    } finally { setBusy(null); }
  }

  return (
    <WorldScreen>
      <WorldHeader title="More Settings" back />
      <ScrollView contentContainerStyle={s.content}>
        {!prefs && !error ? <Spinner /> : null}
        {!prefs && error ? <Empty icon="cloud-offline-outline" title="Can not load settings" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
        {prefs ? (
          <>
            {TOGGLES.map((t) => (
              <View key={t.key} style={s.row}>
                <View style={{ flex: 1, paddingRight: 12 }}><Text style={s.label}>{t.label}</Text><Text style={s.hint}>{t.hint}</Text></View>
                <Switch accessibilityLabel={t.label} disabled={busy !== null} value={prefs[t.key]} onValueChange={(v) => void flip(t.key, v)} trackColor={{ true: world.purple, false: "#D0D5DD" }} thumbColor="#FFFFFF" />
              </View>
            ))}
            {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
            <Pressable accessibilityRole="button" style={s.link} onPress={() => router.push("/countrylinqa/blocked")}><Text style={s.linkText}>Blocked Accounts</Text><Ionicons name="chevron-forward" size={18} color={world.faint} /></Pressable>
            <Pressable accessibilityRole="button" style={s.link} onPress={() => router.push("/countrylinqa/security")}><Text style={s.linkText}>CountryLinqa Privacy</Text><Ionicons name="chevron-forward" size={18} color={world.faint} /></Pressable>
          </>
        ) : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 30, paddingTop: 6 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 66, borderBottomWidth: 1, borderBottomColor: world.border },
  label: { color: world.text, fontFamily: fonts.semibold, fontSize: 16 },
  hint: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14, marginVertical: 10 },
  link: { flexDirection: "row", alignItems: "center", minHeight: 58, borderBottomWidth: 1, borderBottomColor: world.border },
  linkText: { flex: 1, color: world.text, fontFamily: fonts.semibold, fontSize: 16 }
});

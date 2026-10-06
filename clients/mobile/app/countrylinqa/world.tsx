import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { CountryButton, CountryError, CountryLoading, CountryPage, countryStyles as s, countryTabs, useCountryClient } from "../../components/CountryLinqaUI";
import type { CountryLinqaPreferences } from "../../services/countrylinqa.service";
import { useAccounts } from "../../account/AccountContext";

export default function CountryLinqaWorldScreen() {
  const router = useRouter(); const client = useCountryClient(); const { active } = useAccounts();
  const [prefs, setPrefs] = useState<CountryLinqaPreferences | null>(null);
  const [error, setError] = useState<string | null>(null); const [reload, setReload] = useState(0);
  useFocusEffect(useCallback(() => { let current = true; setPrefs(null); setError(null); client.preferences().then(value => { if (current) setPrefs(value); }).catch(cause => { if (current) setError(cause.message); }); return () => { current = false; }; }, [client, reload]));
  return <CountryPage title="Linqa World" actions={<Pressable accessibilityLabel="CountryLinqa notifications" style={s.iconButton} onPress={() => router.push("/countrylinqa/notifications")}><Ionicons name="notifications-outline" size={22} color="#6045E8" /></Pressable>}>
    <View style={[s.card, { backgroundColor: "#6045E8", alignItems: "center", paddingVertical: 30 }]}><Ionicons name="globe-outline" size={90} color="#FFFFFF" /><Text style={[s.title, { color: "#FFFFFF", textAlign: "center" }]}>Connect Locally. Connect Globally.</Text><Text style={[s.copy, { color: "#EEE9FF" }]}>Your world, with you in control.</Text></View>
    <CountryError error={error} retry={() => setReload(value => value + 1)} />
    {!prefs && !error && <CountryLoading />}
    {prefs && <View style={s.card}><View style={s.row}><Text style={s.cardTitle}>{prefs.verifiedCountryCode ?? "Country confirmation required"}</Text><Text style={s.copy}>{prefs.verificationState.replace(/_/g, " ")}</Text></View><Text style={s.copy}>Discovery: {prefs.mode.replace(/_/g, " ")}{prefs.paused ? " · Paused" : ""}</Text><Text style={s.copy}>{[...prefs.selectedCountries, ...prefs.selectedRegions].join(" · ")}</Text><CountryButton secondary label="Manage discovery and visibility" onPress={() => router.push("/settings/countrylinqa")} />{prefs.verificationState !== "VERIFIED" && <CountryButton label="Review country verification" onPress={() => router.push("/onboarding/resolve")} />}</View>}
    <Text style={s.cardTitle}>Discover</Text>
    {countryTabs.map(tab => <Pressable key={tab.kind} style={[s.card, s.row]} accessibilityRole="button" onPress={() => router.push({ pathname: "/countrylinqa/list", params: { kind: tab.kind } })}><Ionicons name={tab.icon} size={28} color="#6045E8" /><Text style={[s.cardTitle, { flex: 1 }]}>{tab.kind === "feed" ? "World Feed" : tab.label}</Text><Ionicons name="chevron-forward" size={20} color="#667085" /></Pressable>)}
    <View style={s.card}><Text style={s.cardTitle}>Search your world</Text><CountryButton label="Advanced search" onPress={() => router.push("/countrylinqa/search")} /><CountryButton secondary label="Saved searches" onPress={() => router.push("/countrylinqa/saved-searches")} /></View>
    <View style={s.card}><Text style={s.cardTitle}>{active?.displayName ?? "Your account"}</Text><Text style={s.copy}>{prefs?.subscriptionTier ?? ""}{prefs ? " plan" : ""}</Text><CountryButton secondary label="My profile" onPress={() => router.push("/countrylinqa/profile")} /><CountryButton secondary label="Account settings" onPress={() => router.push("/account/settings")} /><CountryButton secondary label="Plans and subscription" onPress={() => router.push("/settings/countrylinqa?view=PLANS")} /><CountryButton secondary label="Security and privacy" onPress={() => router.push("/countrylinqa/security")} /><CountryButton secondary label="Help and support" onPress={() => router.push("/support")} /></View>
  </CountryPage>;
}

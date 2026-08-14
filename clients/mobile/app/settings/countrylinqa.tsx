import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { CountryLinqaService, type CountryLinqaPreferences, type DiscoveryMode } from "../../services/countrylinqa.service";
import { accessTokenProvider } from "../../services/session";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";
const modes: Array<{ key: DiscoveryMode; label: string; tier: string }> = [
  { key: "MY_COUNTRY", label: "My Country", tier: "Free" },
  { key: "SELECTED_COUNTRIES", label: "Selected Countries", tier: "Premium" },
  { key: "REGION", label: "Region", tier: "Premium" },
  { key: "GLOBAL", label: "Worldwide", tier: "Elite" }
];

export default function CountryLinqaSettings() {
  const router = useRouter(); const api = useMemo(() => new CountryLinqaService(API, () => accessTokenProvider.getAccessToken()), []);
  const [prefs, setPrefs] = useState<CountryLinqaPreferences | null>(null); const [mode, setMode] = useState<DiscoveryMode>("MY_COUNTRY");
  const [values, setValues] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.preferences().then((value) => { setPrefs(value); setMode(value.mode); setValues((value.mode === "REGION" ? value.selectedRegions : value.selectedCountries).join(", ")); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load settings")); }, [api]);
  async function save() { if (!prefs) return; setBusy(true); setError(null); try {
    const list = values.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    const next = await api.savePreferences({ mode, selectedCountries: mode === "SELECTED_COUNTRIES" ? list : [], selectedRegions: mode === "REGION" ? list : [] });
    setPrefs(next);
  } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save settings"); } finally { setBusy(false); } }
  return <SafeAreaView style={s.screen}><View style={s.header}><Pressable onPress={() => router.back()}><Text style={s.back}>‹</Text></Pressable><Text style={s.title}>Discovery Settings</Text></View>
    <ScrollView contentContainerStyle={s.content}>{!prefs && !error ? <ActivityIndicator color="#6558DC" /> : <>
      <Text style={s.section}>Verified country</Text><View style={s.card}><Text style={s.cardTitle}>{prefs?.verifiedCountryCode ?? "Not verified"}</Text><Text style={s.meta}>State: {prefs?.verificationState ?? "UNKNOWN"}</Text></View>
      <Text style={s.section}>Discovery scope · {prefs?.subscriptionTier}</Text>{modes.map((item) => { const allowed = prefs?.allowedModes[item.key] ?? false; return <Pressable key={item.key} disabled={!allowed} style={[s.mode, mode === item.key && s.modeOn, !allowed && s.locked]} onPress={() => setMode(item.key)}><Text style={s.modeTitle}>{item.label}</Text><Text style={s.badge}>{item.tier}{allowed ? "" : " · Upgrade"}</Text></Pressable>; })}
      {(mode === "SELECTED_COUNTRIES" || mode === "REGION") && <TextInput value={values} onChangeText={setValues} placeholder={mode === "REGION" ? "Region codes" : "Country codes"} autoCapitalize="characters" style={s.input} />}
      {error && <Text style={s.error}>{error.replace(/_/g, " ")}</Text>}<Pressable style={s.button} onPress={save} disabled={busy || !prefs}>{busy ? <ActivityIndicator color="white" /> : <Text style={s.buttonText}>Save Changes</Text>}</Pressable>
    </>}</ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({ screen: { flex: 1, backgroundColor: "#F6F7FB" }, header: { flexDirection: "row", alignItems: "center", padding: 18, gap: 12 }, back: { fontSize: 34, color: "#101828" }, title: { fontSize: 22, fontWeight: "900", color: "#6558DC" }, content: { padding: 18, paddingBottom: 50 }, section: { fontWeight: "900", color: "#101828", marginTop: 18, marginBottom: 9 }, card: { backgroundColor: "white", padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "#E1E6EF" }, cardTitle: { fontSize: 18, fontWeight: "900", color: "#101828" }, meta: { fontSize: 12, color: "#667085", marginTop: 3 }, mode: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "white", borderWidth: 1, borderColor: "#E1E6EF", borderRadius: 14, padding: 14, marginBottom: 8 }, modeOn: { borderColor: "#6558DC", backgroundColor: "#F1EEFF" }, locked: { opacity: .5 }, modeTitle: { fontWeight: "800", color: "#101828" }, badge: { color: "#6558DC", fontSize: 12, fontWeight: "800" }, input: { height: 50, borderWidth: 1, borderColor: "#DDE3EC", borderRadius: 14, backgroundColor: "white", paddingHorizontal: 14 }, error: { color: "#B42318", marginTop: 14 }, button: { height: 54, backgroundColor: "#6558DC", borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 22 }, buttonText: { color: "white", fontWeight: "900" } });

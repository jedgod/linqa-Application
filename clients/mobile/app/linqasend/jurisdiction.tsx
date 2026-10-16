import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { LinqaSendService } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";

const API = getApiBaseUrl();

export default function LinqaSendJurisdiction() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [profile, setProfile] = useState<Awaited<ReturnType<LinqaSendService["getJurisdiction"]>> | null>(null);
  const [relocations, setRelocations] = useState<Awaited<ReturnType<LinqaSendService["listRelocations"]>>["items"]>([]);
  const [country, setCountry] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => Promise.all([client.getJurisdiction(), client.listRelocations()]).then(([p, r]) => { setProfile(p); setRelocations(r.items); setError(""); }).catch((cause) => setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load jurisdiction"));
  useEffect(() => { void load(); }, [client]);
  async function submit() {
    if (!/^[A-Za-z]{2}$/.test(country)) { setError("Enter a two-letter destination country code."); return; }
    setBusy(true); setError("");
    try { await client.requestRelocation(country.toUpperCase(), reason.trim() || undefined); setCountry(""); setReason(""); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to request relocation"); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={s.screen}><View style={s.header}><Pressable onPress={() => router.back()}><Text style={s.back}>‹</Text></Pressable><Text style={s.title}>Jurisdiction & Travel</Text></View><ScrollView contentContainerStyle={s.content}>
    {!profile && !error && <ActivityIndicator color="#5146E5" />}
    {profile && <View style={s.card}><Text style={s.label}>Wallet/account jurisdiction</Text><Text style={s.country}>{profile.regulatoryJurisdiction}</Text><Text style={s.copy}>Your current location does not relabel this wallet. Money movement follows the jurisdiction and regulated entity of the wallet being debited.</Text><View style={s.row}><Text style={s.muted}>Travel state</Text><Text style={s.value}>{profile.locationRelationship.replace(/_/g, " ")}</Text></View><View style={s.row}><Text style={s.muted}>Physical country</Text><Text style={s.value}>{profile.currentPhysicalCountry ?? "Not recently assessed"}</Text></View><View style={s.row}><Text style={s.muted}>Jurisdiction version</Text><Text style={s.value}>{profile.jurisdictionVersion}</Text></View></View>}
    <Text style={s.section}>International relocation</Text><Text style={s.copy}>Relocation requires fresh authentication, verified residency evidence, compliance review, and an eligible regulated entity. Existing wallet balances are not silently migrated.</Text>
    <TextInput value={country} onChangeText={setCountry} autoCapitalize="characters" maxLength={2} placeholder="New country code (for example, GH)" style={s.input} />
    <TextInput value={reason} onChangeText={setReason} placeholder="Reason for relocation (optional)" style={s.input} />
    <Pressable style={[s.button, busy && s.disabled]} disabled={busy} onPress={submit}>{busy ? <ActivityIndicator color="white" /> : <Text style={s.buttonText}>Request relocation review</Text>}</Pressable>
    {error && <Text role="alert" style={s.error}>{error}</Text>}
    <Text style={s.section}>Requests</Text>{relocations.length === 0 ? <Text style={s.muted}>No relocation requests.</Text> : relocations.map((item) => <View key={item.id} style={s.request}><Text style={s.value}>{item.from_country} → {item.requested_country}</Text><Text style={s.status}>{item.status.replace(/_/g, " ")}</Text><Text style={s.muted}>{new Date(item.requested_at).toLocaleDateString()}</Text></View>)}
  </ScrollView></SafeAreaView>;
}

const s = StyleSheet.create({ screen: { flex: 1, backgroundColor: "#F6F7FB" }, header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 18 }, back: { fontSize: 18, color: "#101828" }, title: { fontSize: 18, fontWeight: "900", color: "#101828" }, content: { padding: 18, paddingBottom: 48 }, card: { backgroundColor: "white", borderWidth: 1, borderColor: "#E1E6EF", borderRadius: 16, padding: 16 }, label: { color: "#667085", fontSize: 12, fontWeight: "700" }, country: { color: "#101828", fontSize: 18, fontWeight: "900", marginVertical: 6 }, copy: { color: "#667085", fontSize: 12, lineHeight: 18, marginBottom: 12 }, row: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#EEF0F4", paddingVertical: 10 }, muted: { color: "#667085", fontSize: 12 }, value: { color: "#101828", fontWeight: "800" }, section: { color: "#101828", fontWeight: "900", fontSize: 16, marginTop: 22, marginBottom: 8 }, input: { height: 50, borderWidth: 1, borderColor: "#DDE3EC", borderRadius: 14, backgroundColor: "white", paddingHorizontal: 14, marginTop: 10 }, button: { height: 52, borderRadius: 14, backgroundColor: "#5146E5", justifyContent: "center", alignItems: "center", marginTop: 14 }, disabled: { opacity: 0.6 }, buttonText: { color: "white", fontWeight: "900" }, error: { color: "#B42318", marginTop: 12 }, request: { backgroundColor: "white", borderWidth: 1, borderColor: "#E1E6EF", borderRadius: 14, padding: 14, marginBottom: 10 }, status: { color: "#B54708", fontWeight: "800", fontSize: 12, marginVertical: 4 } });

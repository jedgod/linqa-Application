import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CountryLinqaService } from "../../services/countrylinqa.service";
import { OnboardingApiService, type OnboardingStatus } from "../../services/onboarding.service";
import { accessTokenProvider } from "../../services/session";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { getApiBaseUrl } from "../../config/api";
import { safeReturn } from "../../services/countrylinqa-plans";

const API = getApiBaseUrl();
function flag(code: string) { return String.fromCodePoint(...code.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0))); }

export default function CountryConfirmation() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const country = useMemo(() => new CountryLinqaService(API, () => accessTokenProvider.getAccessToken()), []);
  const onboarding = useMemo(() => new OnboardingApiService(API, accessTokenProvider), []);
  const [status, setStatus] = useState<OnboardingStatus | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { onboarding.status().then(setStatus).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to detect country.")); }, [onboarding]);
  async function confirm() { if (!status?.detectedCountry) return; setBusy(true); setError(null); try {
    const result = await country.confirmCountry(status.detectedCountry.code);
    router.replace(result.reviewRequired ? "/onboarding/security-review" : returnTo ? (safeReturn(returnTo, "/countrylinqa/world") as never) : "/onboarding/resolve");
  } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to confirm country."); } finally { setBusy(false); } }
  return <SafeAreaView style={s.screen}><View style={s.content}>
    <Pressable onPress={() => router.back()} accessibilityLabel="Back"><Ionicons name="chevron-back" size={27} color="#344054" /></Pressable>
    <View style={s.hero}><Text style={s.eyebrow}>DETECTED COUNTRY</Text><Text style={s.title}>We detected your country</Text>
      <Text style={s.copy}>This comes from your server-verified phone evidence. CountryLinqa does not send another OTP.</Text></View>
    {!status && !error ? <ActivityIndicator style={s.loader} color="#6045E8" /> : status?.detectedCountry ? <View style={s.countryCard}>
      <Text style={s.flag}>{flag(status.detectedCountry.code)}</Text><Text style={s.countryName}>{status.detectedCountry.name}</Text>
      <Text style={s.countryCode}>{status.detectedCountry.callingCode ?? ""} · {status.detectedCountry.code}</Text>
    </View> : <ErrorBanner message={error ?? "Verified phone country evidence is unavailable."} />}
    <Pressable style={s.change} onPress={() => router.push("/onboarding/country-clarification")}><Text style={s.changeText}>Change Country</Text></Pressable>
    <View style={s.bottom}><ErrorBanner message={error} /><PrimaryButton label="Continue" onPress={confirm} disabled={!status?.detectedCountry} busy={busy} /></View>
  </View></SafeAreaView>;
}
const s = StyleSheet.create({ screen: { flex: 1, backgroundColor: "#FFFFFF" }, content: { flex: 1, padding: 22, paddingTop: 18 }, hero: { alignItems: "center", marginTop: 30 }, eyebrow: { color: "#6558DC", fontWeight: "900", fontSize: 12, letterSpacing: 1 }, title: { color: "#101828", fontSize: 25, fontWeight: "900", marginTop: 10, textAlign: "center" }, copy: { color: "#667085", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 10, paddingHorizontal: 12 }, loader: { marginTop: 80 }, countryCard: { alignItems: "center", marginTop: 46 }, flag: { fontSize: 88 }, countryName: { color: "#101828", fontSize: 24, fontWeight: "900", marginTop: 14 }, countryCode: { color: "#667085", fontSize: 14, marginTop: 6 }, change: { alignSelf: "center", padding: 14, marginTop: 12 }, changeText: { color: "#6558DC", fontSize: 15, fontWeight: "800" }, bottom: { marginTop: "auto", paddingBottom: 18 } });

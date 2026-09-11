import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { accessTokenProvider } from "../../services/session";
import { ScreenHeader } from "../../components/ScreenHeader"; import { CodeInput } from "../../components/CodeInput";
import { PrimaryButton } from "../../components/PrimaryButton"; import { ErrorBanner } from "../../components/ErrorBanner";
const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8080";
export default function RecoveryVerify() {
  const router = useRouter(); const params = useLocalSearchParams<{ challengeId: string }>();
  const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function verify() { setBusy(true); setError(null); try {
    const response = await fetch(`${API}/v1/account/recovery-email/verify`, { method: "POST", headers: {
      authorization: `Bearer ${await accessTokenProvider.getAccessToken()}`, "content-type": "application/json"
    }, body: JSON.stringify({ challengeId: params.challengeId, code }) });
    const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? "Invalid code");
    router.replace("/onboarding/resolve");
  } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to verify"); } finally { setBusy(false); } }
  return <SafeAreaView style={s.screen}><View style={s.content}><ScreenHeader title="Verify recovery email" copy="Enter the 6-digit code." />
    <View style={s.field}><CodeInput value={code} onChange={setCode} /></View><ErrorBanner message={error} />
    <PrimaryButton label="Verify" onPress={verify} disabled={code.length !== 6} busy={busy} /></View></SafeAreaView>;
}
const s = StyleSheet.create({ screen: { flex: 1, backgroundColor: "#fff" }, content: { padding: 22, paddingTop: 48 }, field: { marginVertical: 20 } });

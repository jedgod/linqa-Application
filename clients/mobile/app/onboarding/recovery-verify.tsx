import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { accessTokenProvider } from "../../services/session";
import { ScreenHeader } from "../../components/ScreenHeader"; import { CodeInput } from "../../components/CodeInput";
import { PrimaryButton } from "../../components/PrimaryButton"; import { ErrorBanner } from "../../components/ErrorBanner";
import { getApiBaseUrl } from "../../config/api";
const API = getApiBaseUrl();
export default function RecoveryVerify() {
  const router = useRouter(); const params = useLocalSearchParams<{ challengeId: string; flow?: string }>();
  const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function verify() { setBusy(true); setError(null); try {
    const response = await fetch(`${API}/v1/account/recovery-email/verify`, { method: "POST", headers: {
      authorization: `Bearer ${await accessTokenProvider.getAccessToken()}`, "content-type": "application/json"
    }, body: JSON.stringify({ challengeId: params.challengeId, code }) });
    const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? "Invalid code");
    router.replace(params.flow === "ADD_ACCOUNT"
      ? { pathname: "/onboarding/resolve", params: { flow: "ADD_ACCOUNT" } }
      : "/onboarding/resolve");
  } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to verify"); } finally { setBusy(false); } }
  return <SafeAreaView style={s.screen}><View style={s.content}><ScreenHeader eyebrow={params.flow === "ADD_ACCOUNT" ? "STEP 13 OF 15 · SECOND ACCOUNT EMAIL VERIFICATION" : "STEP 7 OF 15 · EMAIL VERIFICATION"} title="Verify recovery email" copy="Enter the 6-digit code." />
    <View style={s.field}><CodeInput value={code} onChange={setCode} /></View><ErrorBanner message={error} />
    <PrimaryButton label="Verify" onPress={verify} disabled={code.length !== 6} busy={busy} /></View></SafeAreaView>;
}
const s = StyleSheet.create({ screen: { flex: 1, backgroundColor: "#fff" }, content: { padding: 22, paddingTop: 48 }, field: { marginVertical: 20 } });

import { useState } from "react";
import { SafeAreaView, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { accessTokenProvider } from "../../services/session";
import { ScreenHeader } from "../../components/ScreenHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";
export default function RecoverySetup() {
  const router = useRouter(); const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function next() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${API}/v1/account/recovery-email`, { method: "POST", headers: {
        authorization: `Bearer ${await accessTokenProvider.getAccessToken()}`, "content-type": "application/json"
      }, body: JSON.stringify({ email }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to start recovery setup");
      router.replace({ pathname: "/onboarding/recovery-verify", params: { challengeId: data.challengeId } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to continue"); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={s.screen}><View style={s.content}>
    <ScreenHeader eyebrow="ACCOUNT RECOVERY" title="Add a recovery email" copy="Required for a new account. Existing configured accounts skip this step automatically." />
    <TextInput style={s.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com" />
    <ErrorBanner message={error} /><PrimaryButton label="Send recovery code" onPress={next} disabled={!email} busy={busy} />
  </View></SafeAreaView>;
}
const s = StyleSheet.create({ screen: { flex: 1, backgroundColor: "#fff" }, content: { padding: 22, paddingTop: 48 }, input: { height: 54, borderWidth: 1, borderColor: "#E1E6EF", borderRadius: 12, paddingHorizontal: 14, marginVertical: 20 } });

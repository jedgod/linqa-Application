import { useState } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PhoneFirstIdentityService } from "../../services/phone-first.service";
import { accessTokenProvider } from "../../services/session";
import { ScreenHeader } from "../../components/ScreenHeader";
import { CodeInput } from "../../components/CodeInput";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { colors } from "../../theme/tokens";

const client = new PhoneFirstIdentityService(process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080", () => accessTokenProvider.getAccessToken());

export default function VerifyPhone() {
  const router = useRouter();
  const p = useLocalSearchParams<{ flowId: string; phoneIdentityId: string; challengeId: string }>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true); setError(null);
    try {
      await client.verifyPhone(p.flowId, { phoneIdentityId: p.phoneIdentityId, challengeId: p.challengeId, code });
      router.replace({ pathname: "/auth/recovery-email", params: { flowId: p.flowId } });
    } catch (e) { setError(e instanceof Error ? e.message : "Invalid code."); }
    finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader title="Verify phone" copy="Enter the 6-digit SMS code." />
        <View style={s.field}>
          <CodeInput value={code} onChange={setCode} />
        </View>
        <PrimaryButton label="Verify phone" onPress={verify} disabled={code.length !== 6} busy={busy} />
        <ErrorBanner message={error} />
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { padding: 22, paddingTop: 48 },
  field: { marginVertical: 20 }
});

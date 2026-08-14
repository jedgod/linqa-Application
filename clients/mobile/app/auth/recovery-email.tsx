import { useState } from "react";
import { SafeAreaView, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PhoneFirstIdentityService } from "../../services/phone-first.service";
import { accessTokenProvider } from "../../services/session";
import { ScreenHeader } from "../../components/ScreenHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { colors, radius } from "../../theme/tokens";

const client = new PhoneFirstIdentityService(process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080", () => accessTokenProvider.getAccessToken());

export default function RecoveryEmail() {
  const router = useRouter();
  const p = useLocalSearchParams<{ flowId: string }>();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true); setError(null);
    try {
      const r = await client.startRecoveryEmail(p.flowId, email);
      router.push({ pathname: "/auth/verify-recovery-email", params: {
        flowId: p.flowId, identityId: r.identityId, challengeId: r.challengeId, maskedEmail: r.maskedEmail
      }});
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to send email code."); }
    finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader
          eyebrow="PHONE VERIFIED"
          title="Link recovery email"
          copy="A verified recovery email is required before this account is activated on the installation."
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          style={s.input}
          placeholder="you@example.com"
          placeholderTextColor="#667085"
        />
        <PrimaryButton label="Send email code" onPress={send} disabled={!email.includes("@")} busy={busy} />
        <ErrorBanner message={error} />
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { padding: 22, paddingTop: 48 },
  input: {
    height: 55, borderRadius: 12, backgroundColor: "#F7F7F9", borderWidth: 1,
    borderColor: "#E6EBF1", color: "#111827", paddingHorizontal: 14, marginTop: 18, marginBottom: 20
  }
});

import { useState } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PhoneFirstIdentityService } from "../../services/phone-first.service";
import { accessTokenProvider } from "../../services/session";
import { AccountSecureStorage } from "../../account/AccountSecureStorage";
import { AccountSessionStore } from "../../account/AccountSessionStore";
import { useAccounts } from "../../account/AccountContext";
import { ScreenHeader } from "../../components/ScreenHeader";
import { CodeInput } from "../../components/CodeInput";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { colors } from "../../theme/tokens";

const client = new PhoneFirstIdentityService(process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080", () => accessTokenProvider.getAccessToken());
const sessions = new AccountSessionStore(new AccountSecureStorage());

export default function VerifyRecoveryEmail() {
  const router = useRouter();
  const { active, accounts, setAccounts } = useAccounts();
  const p = useLocalSearchParams<{ flowId: string; identityId: string; challengeId: string; maskedEmail?: string }>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    if (!active) throw new Error("active account missing");
    setBusy(true); setError(null);
    try {
      await client.verifyRecoveryEmail(p.flowId, { identityId: p.identityId, challengeId: p.challengeId, code });
      const result = await client.activate(p.flowId);
      if (result.session) await sessions.save({ userId: active.userId, ...result.session });
      setAccounts(accounts.map((a) => (a.userId === active.userId ? { ...a, slot: result.accountSlot } : a)));
      router.replace("/auth/account-created");
    } catch (e) { setError(e instanceof Error ? e.message : "Recovery verification failed."); }
    finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader
          title="Verify recovery email"
          copy={`Enter the code sent to ${p.maskedEmail ?? "your email"}. The code is single-use.`}
        />
        <View style={s.field}>
          <CodeInput value={code} onChange={setCode} />
        </View>
        <PrimaryButton label="Activate account" onPress={finish} disabled={code.length !== 6} busy={busy} />
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

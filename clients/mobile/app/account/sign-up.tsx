import { useState } from "react";
import { SafeAreaView, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { BootstrapAuthService } from "../../services/bootstrap-auth.service";
import { ScreenHeader } from "../../components/ScreenHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { validateIdentifierInput } from "../../auth/validation";
import { colors, radius } from "../../theme/tokens";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";
const bootstrapAuth = new BootstrapAuthService(API_BASE_URL);

export default function SignUpScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    const validation = validateIdentifierInput(phone);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await bootstrapAuth.requestChallenge(validation.normalized);
      router.push({
        pathname: "/account/sign-up-verify",
        params: { challengeId: result.challengeId, phone: validation.normalized }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send a verification code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader
          eyebrow="WELCOME TO LINQA"
          title="Enter your mobile number"
          copy="We'll text you a 6-digit code. If this number already has a Linqa account, this signs you in on this device instead of creating a new one."
        />
        <TextInput
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+1 202 555 0123"
          placeholderTextColor="#667085"
          style={s.input}
          autoFocus
        />
        <PrimaryButton label="Continue" onPress={handleContinue} disabled={!phone || busy} busy={busy} />
        <ErrorBanner message={error} />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { padding: 22, paddingTop: 48 },
  input: {
    height: 54,
    backgroundColor: "#F7F7F9",
    borderWidth: 1,
    borderColor: "#E6EBF1",
    borderRadius: 12,
    color: "#111827",
    paddingHorizontal: 14,
    marginTop: 18,
    marginBottom: 20,
    fontSize: 16,
    fontWeight: "500"
  }
});

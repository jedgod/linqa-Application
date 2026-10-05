import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BootstrapAuthService } from "../../services/bootstrap-auth.service";
import { ScreenHeader } from "../../components/ScreenHeader";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { validateIdentifierInput } from "../../auth/validation";
import { colors, radius } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";

const API_BASE_URL = getApiBaseUrl();
const bootstrapAuth = new BootstrapAuthService(API_BASE_URL);

export default function SignUpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ purpose?: string; addAccount?: string }>();
  const purpose = params.purpose === "LOGIN" ? "LOGIN" : "REGISTRATION";
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
      const result = await bootstrapAuth.requestChallenge(validation.normalized, purpose);
      router.push({
        pathname: "/account/sign-up-verify",
        params: { challengeId: result.challengeId, phone: validation.normalized, purpose, addAccount: params.addAccount ?? "0" }
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
          eyebrow={purpose === "LOGIN" ? "SIGN IN TO LINQA" : "CREATE YOUR LINQA ACCOUNT"}
          title={purpose === "LOGIN" ? "Welcome back" : "Enter your mobile number"}
          copy={purpose === "LOGIN" ? "Use the verified number for your existing Linqa account." : "We'll verify this genuine mobile line once and use that evidence throughout onboarding."}
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

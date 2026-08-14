import { useState } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PhoneFirstIdentityService } from "../../services/phone-first.service";
import { accessTokenProvider } from "../../services/session";
import { ScreenHeader } from "../../components/ScreenHeader";
import { PhoneField } from "../../components/PhoneField";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { colors } from "../../theme/tokens";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";
const phoneFirst = new PhoneFirstIdentityService(API, () => accessTokenProvider.getAccessToken());

export default function RegisterPhoneScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ flowId: string; phone?: string }>();
  const [country, setCountry] = useState("US");
  const [number, setNumber] = useState(params.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const result = await phoneFirst.submitPhone(params.flowId, country, number);
      if (result.state === "PHONE_REVIEW_REQUIRED") throw new Error("This number requires manual review.");
      if (!result.challengeId) throw new Error("SMS challenge was not issued.");
      router.push({ pathname: "/auth/verify-phone", params: {
        flowId: params.flowId, phoneIdentityId: result.phoneIdentityId, challengeId: result.challengeId
      }});
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to verify this number."); }
    finally { setBusy(false); }
  }
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader
          eyebrow="PHONE-FIRST IDENTITY"
          title="Confirm your mobile line"
          copy="Linqa validates E.164 format, carrier line type and risk before sending an OTP."
        />
        <View style={s.field}>
          <PhoneField country={country} onCountryChange={setCountry} number={number} onNumberChange={setNumber} />
        </View>
        <PrimaryButton label="Send SMS code" onPress={submit} disabled={number.length < 4} busy={busy} />
        <ErrorBanner message={error} />
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { padding: 22, paddingTop: 48 },
  field: { marginBottom: 20 }
});

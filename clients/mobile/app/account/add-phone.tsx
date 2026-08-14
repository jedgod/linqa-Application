import { useState } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MultiAccountApiService } from "../../services/multi-account.service";
import { accessTokenProvider } from "../../services/session";
import { ScreenHeader } from "../../components/ScreenHeader";
import { PhoneField } from "../../components/PhoneField";
import { PrimaryButton } from "../../components/PrimaryButton";
import { ErrorBanner } from "../../components/ErrorBanner";
import { colors, radius } from "../../theme/tokens";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";

export default function AddPhoneAccountScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("US");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleVerify() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const client = new MultiAccountApiService(API_BASE_URL, () => accessTokenProvider.getAccessToken());
      const result = await client.startPhoneVerification({ phoneNumber: phone, defaultCountry: country });

      if (result.state === "OTP_REQUIRED" && result.challengeId) {
        router.push({
          pathname: "/account/verify-phone",
          params: { phoneIdentityId: result.phoneIdentityId, challengeId: result.challengeId }
        });
        return;
      }

      if (result.state === "REVIEW_REQUIRED") {
        setNotice("This number needs manual review before it can be verified.");
        return;
      }

      setNotice(`Verification state: ${result.state}`);
    } catch (err) {
      // Includes the case where no session is active yet — adding a
      // second/third account requires an existing signed-in account on
      // this installation first (see FINAL_CHECKLIST.md: "Add-account
      // requires fresh authentication"). This client has no first-login/
      // signup flow of its own yet.
      setError(err instanceof Error ? err.message : "Unable to start phone verification.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.content}>
        <ScreenHeader
          eyebrow="ADD LINQA ACCOUNT"
          title="Verify mobile number"
          copy="Linqa requires a genuine mobile number. Disposable, temporary, hosted, and known VoIP numbers are not eligible."
          showBack
        />

        <View style={s.field}>
          <PhoneField country={country} onCountryChange={setCountry} number={phone} onNumberChange={setPhone} />
        </View>

        <PrimaryButton label="Verify Number" onPress={handleVerify} disabled={!phone} busy={busy} />

        <ErrorBanner message={error} />
        {notice && <Text style={s.noticeInline}>{notice}</Text>}

        <View style={s.notice}>
          <Text style={s.noticeText}>
            Verification includes international number validation, carrier/line-type checks, fraud-risk screening, and OTP.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingTop: 40 },
  field: { marginBottom: 20 },
  noticeInline: { color: colors.accent, marginTop: 12, fontSize: 12 },
  notice: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 13, marginTop: 14 },
  noticeText: { color: "#9BC8C5", fontSize: 11, lineHeight: 17 }
});

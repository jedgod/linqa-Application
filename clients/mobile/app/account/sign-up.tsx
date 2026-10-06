import { useEffect, useState, useMemo } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { BootstrapAuthService } from "../../services/bootstrap-auth.service";
import { ErrorBanner } from "../../components/ErrorBanner";
import { validateIdentifierInput } from "../../auth/validation";
import { fonts, useTheme, type Palette } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";

const API_BASE_URL = getApiBaseUrl();
const bootstrapAuth = new BootstrapAuthService(API_BASE_URL);
const REMEMBERED_PHONE_KEY = "linqa.auth.rememberedPhone";

export default function SignUpScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ purpose?: string; addAccount?: string; countryCode?: string }>();
  const purpose = params.purpose === "LOGIN" ? "LOGIN" : "REGISTRATION";
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadRememberedPhone = async () => {
      try {
        const remembered = Platform.OS === "web"
          ? window.localStorage.getItem(REMEMBERED_PHONE_KEY)
          : await SecureStore.getItemAsync(REMEMBERED_PHONE_KEY);
        if (!cancelled && remembered) {
          setPhone((current) => current || remembered);
        }
      } catch (cause) {
        console.warn("[SignUpScreen] unable to read remembered phone:", cause);
      }
    };
    void loadRememberedPhone();
    return () => { cancelled = true; };
  }, []);

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
      try {
        if (Platform.OS === "web") window.localStorage.setItem(REMEMBERED_PHONE_KEY, validation.normalized);
        else await SecureStore.setItemAsync(REMEMBERED_PHONE_KEY, validation.normalized);
      } catch (cause) {
        console.warn("[SignUpScreen] unable to save remembered phone:", cause);
      }
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
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => router.back()}
          style={s.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.textMuted} />
        </Pressable>

        <View style={s.intro}>
          <View style={s.phoneIcon}>
            <Ionicons name="phone-portrait-outline" size={38} color="#5B3BE8" />
          </View>
          {purpose === "REGISTRATION" && <Text style={s.step}>STEP 3 OF 15</Text>}
          {purpose === "LOGIN" && params.addAccount === "1" && <Text style={s.step}>STEP 12 OF 15</Text>}
          <Text accessibilityRole="header" style={s.title}>Verify your phone</Text>
          <Text style={s.copy}>Enter your mobile number to{"\n"}get started.</Text>
          {purpose === "REGISTRATION" && params.countryCode && (
            <Text style={s.region}>Device region: {params.countryCode}</Text>
          )}
        </View>

        <View style={s.form}>
          <Text style={s.label}>Phone number {purpose === "REGISTRATION" && params.countryCode ? `(${params.countryCode})` : ""}</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+1 202 555 0123"
            placeholderTextColor={colors.textFaint}
            style={s.input}
            autoFocus
            accessibilityLabel="Phone number with country code"
          />
          <Pressable
            accessibilityRole="button"
            onPress={handleContinue}
            disabled={!phone || busy}
            style={({ pressed }) => [s.submit, (!phone || busy) && s.submitDisabled, pressed && s.submitPressed]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={s.submitText}>Continue</Text>
            )}
          </Pressable>
          {busy ? (
            <View style={s.carrierCheck} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color="#5736E8" />
              <View style={s.carrierCopy}>
                <Text style={s.carrierStep}>
                  {purpose === "REGISTRATION" ? "STEP 4 OF 15 · CARRIER CHECK" : "SECURITY CHECK"}
                </Text>
                <Text style={s.smsHint}>Checking carrier, line type, and number eligibility securely.</Text>
              </View>
            </View>
          ) : (
            <Text style={s.smsHint}>We&rsquo;ll check your number and send a verification code by SMS.</Text>
          )}
          <ErrorBanner message={error} />
        </View>

        <View style={s.privacy}>
          <View style={s.privacyHeading}>
            <Ionicons name="lock-closed" size={21} color="#12B76A" />
            <Text style={s.privacyTitle}>Secure &amp; private</Text>
          </View>
          <Text style={s.privacyCopy}>We&rsquo;ll never share your number{"\n"}with anyone.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 8, paddingBottom: 28 },
  back: { width: 42, height: 42, justifyContent: "center" },
  intro: { alignItems: "center", marginTop: 20 },
  phoneIcon: { width: 86, height: 86, borderRadius: 43, backgroundColor: "#F0EDFF", alignItems: "center", justifyContent: "center", marginBottom: 30 },
  title: { color: colors.text, fontFamily: fonts.extrabold, fontSize: 29, lineHeight: 37, textAlign: "center" },
  step: { color: colors.accent, fontFamily: fonts.extrabold, fontSize: 12, letterSpacing: 1, marginBottom: 10 },
  region: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 13, marginTop: 8 },
  copy: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 18, lineHeight: 27, textAlign: "center", marginTop: 13 },
  form: { marginTop: 55 },
  label: { color: colors.textMuted, fontFamily: fonts.medium, fontSize: 16, marginBottom: 12 },
  input: {
    height: 64,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    color: colors.text,
    paddingHorizontal: 16,
    fontFamily: fonts.medium,
    fontSize: 17
  },
  submit: { height: 66, borderRadius: 16, backgroundColor: "#5736E8", alignItems: "center", justifyContent: "center", marginTop: 22 },
  submitDisabled: { opacity: 0.55 },
  submitPressed: { opacity: 0.9 },
  submitText: { color: "#FFFFFF", fontFamily: fonts.extrabold, fontSize: 19 },
  smsHint: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 17 },
  carrierCheck: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 17 },
  carrierCopy: { flexShrink: 1, alignItems: "center" },
  carrierStep: { color: colors.accent, fontFamily: fonts.extrabold, fontSize: 11, letterSpacing: 0.7 },
  privacy: { alignItems: "center", marginTop: 70 },
  privacyHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  privacyTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 17 },
  privacyCopy: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, textAlign: "center", marginTop: 11 }
});

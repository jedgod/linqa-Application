import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { OnboardingApiService, type OnboardingNextStep } from "../../services/onboarding.service";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";

const API = getApiBaseUrl();
const routes: Record<OnboardingNextStep, string> = {
  AUTH_REQUIRED: "/welcome", DEVICE_ENROLLMENT: "/account/sign-up?purpose=LOGIN",
  RECOVERY_SETUP: "/onboarding/recovery", COUNTRY_CONFIRMATION: "/onboarding/country-confirmation",
  COUNTRY_DISCOVERY: "/onboarding/country-discovery", SECURITY_REVIEW: "/onboarding/security-review",
  COMPLETION: "/onboarding/complete", COMPLETE: "/(tabs)/home"
};

export default function OnboardingResolver() {
  const router = useRouter();
  const params = useLocalSearchParams<{ flow?: string }>();
  const client = useMemo(() => new OnboardingApiService(API, accessTokenProvider), []);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    const timer = setTimeout(() => client.status().then((status) => {
      if (!routes[status.nextStep]) throw new Error("Linqa could not resume your account. Please try again.");
      if (!cancelled) {
        if (status.nextStep === "RECOVERY_SETUP" && params.flow === "ADD_ACCOUNT") {
          router.replace({ pathname: "/onboarding/recovery", params: { flow: "ADD_ACCOUNT" } });
        } else {
          router.replace(routes[status.nextStep] as never);
        }
      }
    }).catch((cause) => {
      if (cancelled) return;
      const message = cause instanceof Error ? cause.message : "Unable to resume onboarding.";
      if (/unauthenticated|authenticated session|auth_required/i.test(message)) {
        router.replace("/welcome");
        return;
      }
      setError(message);
    }), 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [client, router, attempt, params.flow]);
  return <SafeAreaView style={s.screen}>
    {!error && <ActivityIndicator color="#6558DC" />}
    <Text accessibilityRole={error ? "alert" : undefined} style={s.text}>{error ?? "Securely resuming your Linqa account…"}</Text>
    {error && <>
      <Pressable accessibilityRole="button" style={s.button} onPress={() => setAttempt((value) => value + 1)}><Text style={s.buttonText}>Try again</Text></Pressable>
      <Pressable accessibilityRole="button" style={s.button} onPress={() => router.replace("/welcome")}><Text style={s.buttonText}>Back to welcome</Text></Pressable>
    </>}
  </SafeAreaView>;
}
const s = StyleSheet.create({ screen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", gap: 14 }, text: { color: "#475467", textAlign: "center", paddingHorizontal: 28 }, button: { paddingHorizontal: 24, paddingVertical: 14 }, buttonText: { color: "#6558DC", fontWeight: "600" } });

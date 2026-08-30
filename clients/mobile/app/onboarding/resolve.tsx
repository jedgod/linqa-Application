import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { OnboardingApiService, type OnboardingNextStep } from "../../services/onboarding.service";
import { accessTokenProvider } from "../../services/session";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";
const routes: Record<OnboardingNextStep, string> = {
  AUTH_REQUIRED: "/welcome", DEVICE_ENROLLMENT: "/account/sign-up?purpose=LOGIN",
  RECOVERY_SETUP: "/onboarding/recovery", COUNTRY_CONFIRMATION: "/onboarding/country-confirmation",
  COUNTRY_DISCOVERY: "/onboarding/country-discovery", SECURITY_REVIEW: "/onboarding/security-review",
  COMPLETION: "/onboarding/complete", COMPLETE: "/(tabs)/home"
};

export default function OnboardingResolver() {
  const router = useRouter();
  const client = useMemo(() => new OnboardingApiService(API, accessTokenProvider), []);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => client.status().then((status) => {
      if (!cancelled) router.replace(routes[status.nextStep] as never);
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
  }, [client, router]);
  return <SafeAreaView style={s.screen}><ActivityIndicator color="#6558DC" /><Text style={s.text}>{error ?? "Securely resuming your Linqa account…"}</Text></SafeAreaView>;
}
const s = StyleSheet.create({ screen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", gap: 14 }, text: { color: "#475467", textAlign: "center", paddingHorizontal: 28 } });

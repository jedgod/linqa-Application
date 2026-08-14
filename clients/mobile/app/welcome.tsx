import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, radius } from "../theme/tokens";

/**
 * The one screen every fresh install was missing: `index.tsx` used to
 * redirect straight to `/(tabs)/home` unconditionally, so a cold start
 * with zero local accounts had no landing page at all — see index.tsx's
 * account-count check, which now routes here instead. "Create Account"
 * and "Sign In" are the same real entry point (`/account/sign-up`)
 * because the real backend unifies them: submitting a phone number either
 * signs in an existing account or creates a new one, whichever applies
 * (see that screen's own copy) — there's no separate "returning user"
 * flow to link to here.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.top}>
        <View style={s.mark}>
          <Text style={s.markText}>LQ</Text>
        </View>
        <Text style={s.wordmark}>LINQA</Text>
        <Text style={s.tagline}>Secure. Private. Yours.</Text>
      </View>

      <View style={s.mid}>
        <Text style={s.title}>Welcome to Linqa</Text>
        <Text style={s.copy}>The secure messenger built for real connections.</Text>
      </View>

      <View style={s.bottom}>
        <PrimaryButton label="Get Started" onPress={() => router.push("/account/sign-up")} />
        <Text style={s.footnote}>Already have an account? Just enter your number on the next screen.</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF", padding: 24 },
  top: { alignItems: "center", marginTop: 36 },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: "#165DFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10
  },
  markText: { color: "#FFFFFF", fontWeight: "900", fontSize: 18 },
  wordmark: { color: "#165DFF", fontSize: 20, fontWeight: "900", letterSpacing: 3 },
  tagline: { color: "#475467", fontSize: 12, marginTop: 8 },
  mid: { alignItems: "center", marginTop: 116 },
  title: { fontSize: 26, fontWeight: "900", color: "#111827" },
  copy: { color: "#475467", textAlign: "center", marginTop: 12, lineHeight: 20, paddingHorizontal: 12 },
  bottom: { marginTop: "auto", marginBottom: 28, gap: 14 },
  footnote: { color: "#667085", textAlign: "center", fontSize: 11, lineHeight: 16 }
});

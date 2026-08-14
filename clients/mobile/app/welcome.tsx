import { Pressable, SafeAreaView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { DottedGlobe } from "../components/DottedGlobe";

export default function WelcomeScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const globeSize = Math.max(220, Math.min(width - 42, height * 0.39, 340));

  return (
    <LinearGradient
      colors={["#7148FF", "#5531DC", "#3925A7", "#21156B"]}
      locations={[0, 0.34, 0.68, 1]}
      start={{ x: 0.52, y: 0 }}
      end={{ x: 0.48, y: 1 }}
      style={styles.gradient}
    >
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <Ionicons name="location-outline" size={62} color="#FFFFFF" accessibilityElementsHidden />
            <Text accessibilityRole="header" style={styles.title}>Linqa World</Text>
            <Text style={styles.tagline}>Connect Locally. Connect Globally.</Text>
            <View style={styles.globeWrap}><DottedGlobe size={globeSize} /></View>
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Get Started, create a Linqa account"
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={() => router.push({ pathname: "/account/sign-up", params: { purpose: "REGISTRATION" } })}
            >
              <Text style={styles.primaryText}>Get Started</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Log in to an existing Linqa account"
              style={({ pressed }) => [styles.login, pressed && styles.loginPressed]}
              onPress={() => router.push({ pathname: "/account/sign-up", params: { purpose: "LOGIN" } })}
            >
              <Text style={styles.loginText}>Log In</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.homeIndicator} />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1 },
  glowTop: { position: "absolute", top: -120, left: -40, right: -40, height: 360, borderRadius: 180, backgroundColor: "rgba(119,76,255,0.25)" },
  glowBottom: { position: "absolute", bottom: -180, left: -90, width: 330, height: 420, borderRadius: 210, backgroundColor: "rgba(19,20,91,0.27)" },
  content: { flex: 1, paddingHorizontal: 28, paddingTop: 36, paddingBottom: 18 },
  hero: { flex: 1, alignItems: "center" },
  title: { marginTop: 18, color: "#FFFFFF", fontSize: 42, lineHeight: 50, fontWeight: "700", letterSpacing: -1.7, textAlign: "center" },
  tagline: { marginTop: 14, color: "rgba(255,255,255,0.68)", fontSize: 18, lineHeight: 25, fontWeight: "500", letterSpacing: -0.35, textAlign: "center" },
  globeWrap: { flex: 1, minHeight: 235, justifyContent: "center", alignItems: "center", marginTop: 8 },
  actions: { gap: 8 },
  primary: { height: 66, borderRadius: 20, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center", shadowColor: "#09092B", shadowOpacity: 0.22, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 7 },
  primaryText: { color: "#4E2BD4", fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  pressed: { opacity: 0.93, transform: [{ scale: 0.992 }] },
  login: { height: 54, borderRadius: 16, justifyContent: "center", alignItems: "center" },
  loginPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  loginText: { color: "#FFFFFF", fontSize: 20, fontWeight: "600", letterSpacing: -0.2 },
  homeIndicator: { alignSelf: "center", width: 132, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.96)", marginBottom: 8 }
});

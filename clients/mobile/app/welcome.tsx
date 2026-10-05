import { Image, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

export default function WelcomeScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const compact = height < 720;
  const globeSize = Math.max(248, Math.min(width - 12, height * (compact ? 0.39 : 0.43), 405));

  return (
    <LinearGradient
      colors={["#7148FF", "#5531DC", "#3925A7", "#21156B"]}
      locations={[0, 0.34, 0.68, 1]}
      start={{ x: 0.52, y: 0 }}
      end={{ x: 0.48, y: 1 }}
      style={styles.gradient}
    >
      <StatusBar style="light" />
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <Ionicons name="location-outline" size={compact ? 56 : 66} color="#FFFFFF" accessibilityElementsHidden />
            <Text accessibilityRole="header" adjustsFontSizeToFit numberOfLines={1} style={[styles.title, compact && styles.titleCompact]}>Linqa World</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.tagline, compact && styles.taglineCompact]}>Connect Locally. Connect Globally.</Text>
            <View style={styles.globeWrap}>
              <Image
                accessibilityLabel="Dotted map of the world"
                source={require("../assets/welcome-globe.png")}
                resizeMode="cover"
                style={{ width: globeSize, height: globeSize * (358 / 388) }}
              />
            </View>
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
        {Platform.OS === "ios" ? <View style={styles.homeIndicator} /> : null}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1 },
  glowTop: { position: "absolute", top: -120, left: -40, right: -40, height: 360, borderRadius: 180, backgroundColor: "rgba(139,83,255,0.26)" },
  glowBottom: { position: "absolute", bottom: -180, left: -90, width: 330, height: 420, borderRadius: 210, backgroundColor: "rgba(19,20,91,0.27)" },
  content: { flex: 1, paddingHorizontal: 30, paddingTop: 34, paddingBottom: 10 },
  hero: { flex: 1, alignItems: "center" },
  title: { marginTop: 16, color: "#FFFFFF", fontSize: 45, lineHeight: 54, fontWeight: "700", letterSpacing: -1.8, textAlign: "center" },
  titleCompact: { marginTop: 10, fontSize: 39, lineHeight: 46 },
  tagline: { marginTop: 12, color: "rgba(230,224,255,0.77)", fontSize: 19, lineHeight: 27, fontWeight: "400", letterSpacing: -0.3, textAlign: "center" },
  taglineCompact: { marginTop: 8, fontSize: 17 },
  globeWrap: { flex: 1, minHeight: 248, justifyContent: "center", alignItems: "center", marginTop: 2 },
  actions: { gap: 6 },
  primary: { height: 66, borderRadius: 18, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center", shadowColor: "#09092B", shadowOpacity: 0.22, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 7 },
  primaryText: { color: "#4E2BD4", fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  pressed: { opacity: 0.93, transform: [{ scale: 0.992 }] },
  login: { height: 54, borderRadius: 16, justifyContent: "center", alignItems: "center" },
  loginPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  loginText: { color: "#FFFFFF", fontSize: 20, fontWeight: "600", letterSpacing: -0.2 },
  homeIndicator: { alignSelf: "center", width: 132, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.96)", marginBottom: 8 }
});

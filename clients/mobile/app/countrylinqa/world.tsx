import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CountryLinqaService, type CountryLinqaPreferences } from "../../services/countrylinqa.service";
import { accessTokenProvider } from "../../services/session";

const purple = "#6f5ae6";
const bg = "#f5f6fa";
const text = "#1f2937";
const softText = "#64748b";
const border = "#e3e8f0";

export default function CountryLinqaWorldScreen() {
  const router = useRouter();
  const client = useMemo(() => new CountryLinqaService(process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080", () => accessTokenProvider.getAccessToken()), []);
  const [preferences, setPreferences] = useState<CountryLinqaPreferences | null>(null);
  useEffect(() => { client.preferences().then(setPreferences).catch(() => setPreferences(null)); }, [client]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Linqa World</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Connect Locally. Connect Globally.</Text>

        <View style={styles.worldCard}>
          <View style={styles.worldMap} />
          <View style={styles.modeRow}>
            <View>
              <Text style={styles.modeLabel}>{preferences?.mode.replace(/_/g, " ") ?? "Discovery scope"}</Text>
              <Text style={styles.modeValue}>{preferences?.verifiedCountryCode ?? "Verification required"}</Text>
            </View>
            <Text style={styles.modePill}>Live</Text>
          </View>
        </View>

        <View style={styles.actionGrid}>
          {[
            ["🌐", "World Feed"],
            ["👥", "People"],
            ["🏬", "Businesses"],
            ["🎉", "Events"],
            ["🏘", "Communities"],
            ["⚙", "Discovery Settings"],
          ].map(([icon, label]) => (
            <Pressable key={label as string} style={styles.gridItem} onPress={() => {
              const routes: Record<string, string> = {
                "World Feed": "/countrylinqa/list?kind=feed&title=World%20Feed",
                People: "/countrylinqa/list?kind=people&title=People",
                Businesses: "/countrylinqa/list?kind=businesses&title=Businesses",
                Events: "/countrylinqa/list?kind=events&title=Events",
                Communities: "/countrylinqa/list?kind=communities&title=Communities",
                "Discovery Settings": "/settings/countrylinqa"
              };
              router.push(routes[label as string] as never);
            }}>
              <Text style={styles.gridIcon}>{icon as string}</Text>
              <Text style={styles.gridLabel}>{label as string}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.primaryButton} onPress={() => router.push("/countrylinqa/list?kind=feed&title=World%20Feed" as never)}>
          <Text style={styles.primaryButtonText}>Open World Feed</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  back: { color: text, fontSize: 30, fontWeight: "700" },
  headerTitle: { flex: 1, color: purple, fontSize: 20, fontWeight: "900", letterSpacing: -0.28 },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32 },
  title: { color: text, fontSize: 20, fontWeight: "900", letterSpacing: -0.32, lineHeight: 28, marginBottom: 14, textAlign: "left" },
  worldCard: { backgroundColor: "#fff", borderRadius: 18, borderWidth: 1, borderColor: border, padding: 14, marginBottom: 18, shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  worldMap: { width: "100%", height: 170, borderRadius: 16, backgroundColor: "#4d5ae7", marginBottom: 14 },
  modeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modeLabel: { color: text, fontSize: 12, fontWeight: "700" },
  modeValue: { color: purple, fontSize: 18, fontWeight: "900", marginTop: 4, letterSpacing: -0.2 },
  modePill: { backgroundColor: "#f1eeff", color: purple, fontSize: 11, fontWeight: "800", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, overflow: "hidden" },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 10 },
  gridItem: { width: "31%", backgroundColor: "#fff", borderWidth: 1, borderColor: border, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingVertical: 12, minHeight: 88 },
  gridIcon: { fontSize: 23 },
  gridLabel: { marginTop: 8, color: text, fontWeight: "700", fontSize: 11.5, textAlign: "center", letterSpacing: -0.1 },
  primaryButton: { marginTop: 22, backgroundColor: purple, borderRadius: 14, height: 48, alignItems: "center", justifyContent: "center", shadowColor: "#6f5ae6", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "900", letterSpacing: 0.08 }
});

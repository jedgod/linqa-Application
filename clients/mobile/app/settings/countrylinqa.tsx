import { useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

const purple = "#6f5ae6";
const text = "#1f2937";
const softText = "#64748b";
const border = "#dfe5f0";
const bg = "#f5f6fa";

export default function CountryLinqaSettings() {
  const router = useRouter();
  const [mode, setMode] = useState("My Country Only");

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Discovery Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Current Mode</Text>
        <View style={styles.modeCard}>
          <Text style={styles.modeLabel}>My Country Only</Text>
          <Text style={styles.modeMeta}>United States</Text>
          <Text style={styles.changeLink}>Change</Text>
        </View>

        <Text style={styles.sectionTitle}>Privacy</Text>
        {[
          ["Show my city", false],
          ["Show my state", true],
          ["Show my country", true],
        ].map(([label, active]) => (
          <View key={label as string} style={styles.toggleRow}>
            <Text style={styles.toggleText}>{label as string}</Text>
            <View style={[styles.toggle, active && styles.toggleOn]}>
              <View style={[styles.toggleKnob, active && styles.toggleKnobOn]} />
            </View>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Who Can See Me</Text>
        <View style={styles.selectCard}>
          <Text style={styles.selectText}>Everyone</Text>
          <Text style={styles.chevron}>›</Text>
        </View>

        <Text style={styles.sectionTitle}>Advanced</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleText}>Hide my location</Text>
          <View style={styles.toggle}>
            <View style={styles.toggleKnob} />
          </View>
        </View>

        <Pressable style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Save Changes</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 24, paddingBottom: 8 },
  back: { color: text, fontSize: 30, fontWeight: "700" },
  headerTitle: { flex: 1, color: purple, fontSize: 22, fontWeight: "900", letterSpacing: -0.35 },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32 },
  sectionTitle: { color: text, fontSize: 13, fontWeight: "800", marginTop: 18, marginBottom: 8, letterSpacing: 0.1 },
  modeCard: { backgroundColor: "#fff", borderWidth: 1, borderColor: border, borderRadius: 14, padding: 12, position: "relative", shadowColor: "#000", shadowOpacity: 0.02, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  modeLabel: { color: text, fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  modeMeta: { color: softText, fontSize: 12, marginTop: 6 },
  changeLink: { position: "absolute", right: 12, top: 18, color: purple, fontSize: 12, fontWeight: "800" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  toggleText: { color: text, fontSize: 15, fontWeight: "600" },
  toggle: { width: 42, height: 22, borderRadius: 18, backgroundColor: "#d9dfe8", padding: 2 },
  toggleOn: { backgroundColor: purple },
  toggleKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff", marginTop: 3, marginLeft: 2 },
  toggleKnobOn: { marginLeft: 22 },
  selectCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderWidth: 1, borderColor: border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 16 },
  selectText: { color: text, fontSize: 16, fontWeight: "700" },
  chevron: { color: softText, fontSize: 18 },
  primaryButton: { marginTop: 24, width: "100%", backgroundColor: purple, borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center", shadowColor: "#6f5ae6", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "900", letterSpacing: 0.1 }
});

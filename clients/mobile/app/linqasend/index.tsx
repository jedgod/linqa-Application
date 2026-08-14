import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, radius } from "../../theme/tokens";

const recentActivity = [
  { name: "To Ama Mensah", amount: "GHS 5,319.00", time: "Today, 9:42 AM", status: "Completed" },
  { name: "To Kwame Boateng", amount: "GHS 2,650.00", time: "May 24, 6:21 PM", status: "Completed" },
  { name: "To Amina Yusuf", amount: "NGN 45,000.00", time: "May 23, 3:10 PM", status: "Completed" }
];

export default function LinqaSendHome() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Text style={styles.brand}>LinqaSend</Text>
          <View style={styles.bellWrap}>
            <Text style={styles.bell}>◔</Text>
          </View>
        </View>

        <Text style={styles.greeting}>Good morning, Daniel</Text>
        <Text style={styles.balanceLabel}>Your Balance</Text>
        <Text style={styles.balance}>$1,250.00 USD</Text>

        <View style={styles.buttonRow}>
          <Pressable style={styles.primaryButton} onPress={() => router.push("/linqasend/recipients")}>
            <Text style={styles.primaryButtonText}>Send Money</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Receive Money</Text>
          </Pressable>
        </View>

        <View style={styles.featureCard}>
          <Text style={styles.featureTitle}>Zero fees to send</Text>
          <Text style={styles.featureText}>Loved ones get more. You pay nothing extra.</Text>
        </View>

        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickRow}>
          <View style={styles.quickItem}><Text style={styles.quickGlyph}>🏠</Text><Text style={styles.quickText}>Add Money</Text></View>
          <View style={styles.quickItem}><Text style={styles.quickGlyph}>👥</Text><Text style={styles.quickText}>Global Contacts</Text></View>
          <View style={styles.quickItem}><Text style={styles.quickGlyph}>📊</Text><Text style={styles.quickText}>Transactions</Text></View>
          <View style={styles.quickItem}><Text style={styles.quickGlyph}>⚙️</Text><Text style={styles.quickText}>More</Text></View>
        </View>

        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {recentActivity.map((item) => (
          <View key={item.name} style={styles.activityRow}>
            <View style={styles.activityAvatar}><Text style={styles.activityInitials}>{item.name.charAt(4) || "A"}</Text></View>
            <View style={styles.activityMeta}>
              <Text style={styles.activityName}>{item.name}</Text>
              <Text style={styles.activityWhen}>{item.time}</Text>
            </View>
            <Text style={styles.activityAmount}>{item.amount}</Text>
            <Text style={styles.activityState}>{item.status}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6FA" },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32 },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  brand: { color: "#121A2B", fontSize: 19, fontWeight: "800" },
  bellWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#E9EEF7", justifyContent: "center", alignItems: "center" },
  bell: { color: "#1F2A37", fontSize: 14 },
  greeting: { color: "#101828", fontSize: 20, fontWeight: "800", letterSpacing: -0.2 },
  balanceLabel: { color: "#667085", fontSize: 12, marginTop: 16 },
  balance: { color: "#101828", fontSize: 28, fontWeight: "900", marginTop: 4, letterSpacing: -0.4 },
  buttonRow: { flexDirection: "row", gap: 12, marginTop: 18 },
  primaryButton: { flex: 1, height: 46, borderRadius: 14, backgroundColor: "#4F46E5", justifyContent: "center", alignItems: "center" },
  primaryButtonText: { color: "#fff", fontWeight: "800", fontSize: 14.5 },
  secondaryButton: { flex: 1, height: 46, borderRadius: 14, backgroundColor: "#F3F6FC", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#DDE4F0" },
  secondaryButtonText: { color: "#1F2A37", fontWeight: "700", fontSize: 14.5 },
  featureCard: { marginTop: 20, borderRadius: 18, backgroundColor: "#E9F8F2", padding: 16, borderWidth: 1, borderColor: "#D6F0E8" },
  featureTitle: { color: "#101828", fontSize: 17, fontWeight: "800" },
  featureText: { color: "#475467", fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  sectionTitle: { color: "#101828", fontSize: 15, fontWeight: "800", marginTop: 24, marginBottom: 12, letterSpacing: -0.1 },
  quickRow: { flexDirection: "row", justifyContent: "space-between" },
  quickItem: { width: "22%", alignItems: "center" },
  quickGlyph: { fontSize: 19 },
  quickText: { fontSize: 10.5, color: "#475467", textAlign: "center", marginTop: 6 },
  activityRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E7EDF5" },
  activityAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#D9E2F4", justifyContent: "center", alignItems: "center" },
  activityInitials: { color: "#101828", fontWeight: "800", fontSize: 12 },
  activityMeta: { flex: 1, marginLeft: 10 },
  activityName: { color: "#101828", fontWeight: "700", fontSize: 13 },
  activityWhen: { color: "#667085", fontSize: 11, marginTop: 3 },
  activityAmount: { color: "#101828", fontWeight: "700", fontSize: 12, marginRight: 8 },
  activityState: { color: "#12A673", fontWeight: "700", fontSize: 10 }
});

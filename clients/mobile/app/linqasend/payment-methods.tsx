import { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

const cards = [
  { brand: "Visa", number: "•••• 4242", expires: "Expires 12/27", selected: true },
  { brand: "Mastercard", number: "•••• 1111", expires: "Expires 08/26", selected: false },
  { brand: "Visa", number: "•••• 5678", expires: "Expires 11/25", selected: false }
];

export default function LinqaSendPaymentMethods() {
  const router = useRouter();
  const [selected, setSelected] = useState("Visa •••• 4242");
  const [cardNo, setCardNo] = useState("4242 4242 4242 4242");

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Payment Methods</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Debit/Credit Cards</Text>

        {cards.map((card) => (
          <Pressable key={card.number} style={[styles.cardRow, selected === `${card.brand} ${card.number}` && styles.cardRowSelected]} onPress={() => setSelected(`${card.brand} ${card.number}`)}>
            <View style={styles.cardBrand}><Text style={styles.cardBrandText}>{card.brand.slice(0, 4)}</Text></View>
            <View style={styles.cardMeta}>
              <Text style={styles.cardName}>{card.brand} {card.number}</Text>
              <Text style={styles.cardExpire}>{card.expires}</Text>
            </View>
            <Text style={[styles.radio, selected === `${card.brand} ${card.number}` && styles.radioSelected]}>{selected === `${card.brand} ${card.number}` ? "✓" : ""}</Text>
          </Pressable>
        ))}

        <Pressable style={styles.linkRow} onPress={() => router.push("/linqasend/payment-methods")}>
          <Text style={styles.linkPlus}>＋</Text>
          <Text style={styles.linkText}>Add New Card</Text>
        </Pressable>

        <View style={styles.securityBox}>
          <Text style={styles.securityText}>Your cards are secure and encrypted.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6FA" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 22, paddingBottom: 8 },
  back: { color: "#1F2A37", fontSize: 28, fontWeight: "700" },
  headerTitle: { flex: 1, color: "#111827", fontSize: 22, fontWeight: "800" },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },
  sectionTitle: { color: "#101828", fontSize: 18, fontWeight: "800", marginBottom: 14 },
  cardRow: { backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#E5EAF2", paddingHorizontal: 12, paddingVertical: 14, flexDirection: "row", alignItems: "center", marginBottom: 12 },
  cardRowSelected: { borderColor: "#4F46E5", backgroundColor: "#EEF2FF" },
  cardBrand: { width: 42, height: 28, borderRadius: 8, backgroundColor: "#EAEAFB", justifyContent: "center", alignItems: "center" },
  cardBrandText: { color: "#1F2A37", fontWeight: "800", fontSize: 10 },
  cardMeta: { flex: 1, marginLeft: 12 },
  cardName: { color: "#101828", fontSize: 15, fontWeight: "700" },
  cardExpire: { color: "#667085", fontSize: 11, marginTop: 3 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "#D0D8E2", justifyContent: "center", alignItems: "center", color: "#4F46E5" },
  radioSelected: { borderColor: "#4F46E5", backgroundColor: "#4F46E5", color: "#fff" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18, marginBottom: 18 },
  linkPlus: { color: "#4F46E5", fontSize: 26, fontWeight: "700" },
  linkText: { color: "#1F2A37", fontSize: 16, fontWeight: "700" },
  securityBox: { backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#E4E8F0", padding: 14 },
  securityText: { color: "#667085", textAlign: "center", fontWeight: "700" }
});

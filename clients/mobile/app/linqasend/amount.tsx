import { useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";

export default function LinqaSendAmount() {
  const router = useRouter();
  const [amount, setAmount] = useState("500.00");

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Enter Amount</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.label}>You send</Text>
        <View style={styles.inputRow}>
          <View style={styles.currencyBox}><Text style={styles.currency}>🇺🇸</Text><Text style={styles.currencyText}>USD</Text></View>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={styles.amountInput} />
        </View>

        <Text style={styles.label}>They receive</Text>
        <View style={styles.inputRow}>
          <View style={styles.currencyBox}><Text style={styles.currency}>🇬🇭</Text><Text style={styles.currencyText}>GHS</Text></View>
          <Text style={styles.amountOutput}>5,319.00</Text>
        </View>

        <View style={styles.exchangeRow}>
          <Text style={styles.exchangeLabel}>Exchange rate (Guaranteed 30s)</Text>
          <Text style={styles.exchangeValue}>1 USD = 10.6380 GHS</Text>
        </View>

        <View style={styles.feeRow}><Text style={styles.feeLabel}>Transfer fee</Text><Text style={styles.feeValue}>$0.00</Text></View>
        <View style={styles.feeRow}><Text style={styles.feeLabel}>Recipient fee</Text><Text style={styles.feeValue}>$0.00</Text></View>

        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>Zero fees. Great rates. Recipient gets more.</Text>
        </View>

        <Pressable style={styles.primaryButton} onPress={() => router.push("/linqasend/review")}>
          <Text style={styles.primaryButtonText}>Continue</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6FA" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 22, paddingBottom: 8 },
  back: { color: "#1F2A37", fontSize: 28, fontWeight: "700" },
  headerTitle: { flex: 1, color: "#111827", fontSize: 22, fontWeight: "800" },
  content: { paddingHorizontal: 18, paddingTop: 16 },
  label: { color: "#475467", fontSize: 13, marginTop: 18, marginBottom: 10, fontWeight: "600" },
  inputRow: { backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E4E8F0", height: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  currencyBox: { flexDirection: "row", alignItems: "center", paddingRight: 8, borderRightWidth: 1, borderRightColor: "#EEF2F7", marginRight: 10 },
  currency: { fontSize: 18 },
  currencyText: { color: "#101828", fontWeight: "800", fontSize: 14, marginLeft: 8 },
  amountInput: { flex: 1, color: "#101828", fontSize: 22, fontWeight: "800", textAlign: "right" },
  amountOutput: { flex: 1, color: "#101828", fontSize: 22, fontWeight: "800", textAlign: "right" },
  exchangeRow: { backgroundColor: "#EEF3FF", borderRadius: 12, padding: 14, marginTop: 16 },
  exchangeLabel: { color: "#475467", fontSize: 12, fontWeight: "700" },
  exchangeValue: { color: "#101828", fontSize: 16, fontWeight: "800", marginTop: 8 },
  feeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E7EDF5" },
  feeLabel: { color: "#475467", fontSize: 13, fontWeight: "700" },
  feeValue: { color: "#101828", fontSize: 15, fontWeight: "800" },
  noticeBox: { marginTop: 18, borderRadius: 14, backgroundColor: "#EAF7F1", padding: 14, alignItems: "center", justifyContent: "center" },
  noticeText: { color: "#1E4E3A", fontSize: 13, fontWeight: "700", textAlign: "center" },
  primaryButton: { backgroundColor: "#4F46E5", height: 52, borderRadius: 14, justifyContent: "center", alignItems: "center", marginTop: 18 },
  primaryButtonText: { color: "#fff", fontWeight: "900", fontSize: 16 }
});

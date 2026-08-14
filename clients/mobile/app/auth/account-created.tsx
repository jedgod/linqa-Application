import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { PrimaryButton } from "../../components/PrimaryButton";
import { colors } from "../../theme/tokens";

const STEPS = ["Phone number", "Recovery email", "Account status"];

export default function AccountCreated() {
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.check}>
        <Ionicons name="checkmark" size={52} color="#FFFFFF" />
      </View>
      <Text style={s.title}>Account created!</Text>
      <Text style={s.copy}>Your phone number and recovery email have been verified.</Text>
      {STEPS.map((label) => (
        <View key={label} style={s.row}>
          <Ionicons name="checkmark-circle" color="#20B86A" size={17} />
          <Text style={s.label}>{label}</Text>
          <Text style={s.state}>{label === "Account status" ? "Active" : "Verified"}</Text>
        </View>
      ))}
      <View style={s.bottom}>
        <PrimaryButton label="Continue to Linqa" onPress={() => router.replace("/(tabs)/home")} />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF", padding: 22, alignItems: "center", paddingTop: 70 },
  check: { width: 84, height: 84, borderRadius: 42, backgroundColor: "#20B86A", alignItems: "center", justifyContent: "center" },
  title: { color: "#111827", fontSize: 24, fontWeight: "900", marginTop: 22 },
  copy: { color: "#475467", textAlign: "center", marginTop: 9, marginBottom: 32 },
  row: { width: "100%", flexDirection: "row", alignItems: "center", marginBottom: 16 },
  label: { flex: 1, marginLeft: 8, color: "#111827" },
  state: { color: "#20B86A", fontWeight: "800", fontSize: 11 },
  bottom: { width: "100%", marginTop: "auto", marginBottom: 20 }
});

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function LinkedDeviceAlertCard({
  deviceName,
  platform,
  location,
  createdAt,
  riskLevel,
  onVerify,
  onRevoke,
}: {
  deviceName: string;
  platform: string;
  location?: string;
  createdAt: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  onVerify(): void;
  onRevoke(): void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.icon}>
        <Ionicons
          name="phone-portrait-outline"
          size={24}
          color={riskLevel === "HIGH" ? "#FF6B7A" : "#12D6AE"}
        />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.title}>New linked device</Text>
        <Text style={styles.device}>{deviceName}</Text>
        <Text style={styles.meta}>
          {platform}
          {location ? ` · ${location}` : ""} ·{" "}
          {new Date(createdAt).toLocaleString()}
        </Text>

        <View style={styles.actions}>
          <Pressable style={styles.verify} onPress={onVerify}>
            <Text style={styles.verifyText}>Verify</Text>
          </Pressable>
          <Pressable style={styles.revoke} onPress={onRevoke}>
            <Text style={styles.revokeText}>Revoke</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#082536",
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#FFB84D",
    padding: 14,
    flexDirection: "row",
    gap: 12,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "#061E2C",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: "#FFCF7B", fontSize: 12, fontWeight: "900" },
  device: { color: "#F2F8FC", fontSize: 15, fontWeight: "800", marginTop: 3 },
  meta: { color: "#768FA1", fontSize: 12, marginTop: 3 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  verify: {
    backgroundColor: "#12D6AE",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  verifyText: { color: "#001E26", fontWeight: "900" },
  revoke: {
    backgroundColor: "#2A1D2A",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  revokeText: { color: "#FF8B97", fontWeight: "900" },
});

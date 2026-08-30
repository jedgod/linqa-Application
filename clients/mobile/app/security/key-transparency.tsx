import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Milestone3Service } from "../../services/milestone3.service";
import { accessTokenProvider } from "../../services/session";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";

export default function KeyTransparencyScreen() {
  const [devices, setDevices] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = new Milestone3Service(API_BASE_URL, () => accessTokenProvider.getAccessToken());
    client
      .keyTransparency()
      .then((result) => setDevices(result.devices ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load key transparency data."));
  }, []);

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.eyebrow}>KEY TRANSPARENCY</Text>
        <Text style={s.title}>Identity Verification</Text>
        <Text style={s.subtitle}>Verify that Linqa has not silently substituted device keys.</Text>

        {error && <Text style={s.errorText}>{error}</Text>}

        {devices.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="shield-checkmark-outline" size={42} color="#12D6AE" />
            <Text style={s.emptyTitle}>No transparency proof loaded</Text>
            <Text style={s.emptyText}>
              {error ? "Key transparency is not reachable right now." : "No devices have a recorded transparency proof yet."}
            </Text>
          </View>
        ) : (
          devices.map((device) => (
            <View key={device.id} style={s.card}>
              <View style={s.row}>
                <Ionicons
                  name={device.verified_at ? "checkmark-circle" : "alert-circle"}
                  size={23}
                  color={device.verified_at ? "#12D6AE" : "#FFB84D"}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{device.device_name}</Text>
                  <Text style={s.meta}>
                    {device.platform} · tree {device.tree_size ?? "unverified"}
                  </Text>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520" },
  content: { padding: 16, paddingBottom: 80 },
  eyebrow: { color: "#12D6AE", fontSize: 11, fontWeight: "800", letterSpacing: 1.3, marginTop: 16 },
  title: { color: "#F5FBFF", fontSize: 27, fontWeight: "900", marginTop: 3 },
  subtitle: { color: "#748EA1", fontSize: 13, lineHeight: 18, marginTop: 6, marginBottom: 18 },
  errorText: { color: "#FF8B97", fontSize: 12, marginBottom: 12 },
  empty: { alignItems: "center", paddingTop: 80 },
  emptyTitle: { color: "#F5FBFF", fontWeight: "800", fontSize: 17, marginTop: 12 },
  emptyText: { color: "#748EA1", fontSize: 12, textAlign: "center", marginTop: 6 },
  card: { backgroundColor: "#082536", borderRadius: 16, borderWidth: 1, borderColor: "#17445A", padding: 14, marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { color: "#F2F8FC", fontWeight: "800" },
  meta: { color: "#748EA1", fontSize: 11, marginTop: 3 }
});

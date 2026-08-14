import React, { useState } from "react";
import { SafeAreaView, ScrollView, Pressable, StyleSheet, Text, ActivityIndicator } from "react-native";
import { GaHardeningService } from "../../services/ga-hardening.service";
import { accessTokenProvider } from "../../services/session";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";

const CATEGORIES = ["Messaging", "Calls", "Account & Login", "Devices", "File Vault", "Billing", "Enterprise", "Privacy", "Emergency"];

export default function SupportScreen() {
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  async function openCase(category: string) {
    setPending(category);
    try {
      const client = new GaHardeningService(API_BASE_URL, () => accessTokenProvider.getAccessToken());
      const result: any = await client.createSupportCase({
        category,
        priority: "NORMAL",
        subject: `${category} support request`,
        description: `Opened from the mobile Support Center for the ${category} category.`
      });
      setStatus((prev) => ({ ...prev, [category]: result?.case_number ? `Case #${result.case_number} opened` : "Case opened" }));
    } catch (err) {
      setStatus((prev) => ({ ...prev, [category]: err instanceof Error ? err.message : "Unable to open a case." }));
    } finally {
      setPending(null);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>Support Center</Text>
        <Text style={s.sub}>Get help without exposing encrypted conversation content.</Text>

        {CATEGORIES.map((item) => (
          <Pressable key={item} style={s.card} onPress={() => openCase(item)} disabled={pending === item}>
            <Text style={s.label}>{status[item] ? `${item} — ${status[item]}` : item}</Text>
            {pending === item ? <ActivityIndicator color="#12D6AE" /> : <Text style={s.arrow}>›</Text>}
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520" },
  content: { padding: 16, paddingBottom: 80 },
  title: { color: "#F5FBFF", fontSize: 28, fontWeight: "900", marginTop: 14 },
  sub: { color: "#748EA1", fontSize: 13, marginTop: 6, marginBottom: 18 },
  card: { minHeight: 62, borderRadius: 15, backgroundColor: "#082536", borderWidth: 1, borderColor: "#17445A", paddingHorizontal: 14, marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { color: "#F2F8FC", fontWeight: "800", flexShrink: 1 },
  arrow: { color: "#587287", fontSize: 28 }
});

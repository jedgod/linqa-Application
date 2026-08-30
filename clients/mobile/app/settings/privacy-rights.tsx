import React, { useState } from "react";
import { ScrollView, Pressable, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GaHardeningService } from "../../services/ga-hardening.service";
import { accessTokenProvider } from "../../services/session";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";

const RIGHTS = [
  ["ACCESS", "Access my data"],
  ["PORTABILITY", "Download my data"],
  ["CORRECT", "Correct my data"],
  ["DELETE", "Delete my account data"],
  ["OPT_OUT_SALE", "Opt out of sale"],
  ["OPT_OUT_SHARING", "Opt out of sharing"],
  ["LIMIT_SENSITIVE_USE", "Limit sensitive-data use"]
] as const;

export default function PrivacyRightsScreen() {
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});

  async function submit(key: (typeof RIGHTS)[number][0]) {
    setPending(key);
    try {
      const client = new GaHardeningService(API_BASE_URL, () => accessTokenProvider.getAccessToken());
      const result: any = await client.createPrivacyRequest({ type: key, jurisdiction: "GDPR" });
      setStatus((prev) => ({ ...prev, [key]: result?.state ?? "Submitted" }));
    } catch (err) {
      setStatus((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : "Unable to submit request." }));
    } finally {
      setPending(null);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.eyebrow}>PRIVACY RIGHTS</Text>
        <Text style={s.title}>Your data controls</Text>
        <Text style={s.sub}>Submit a privacy request. Identity verification may be required.</Text>

        {RIGHTS.map(([key, label]) => (
          <Pressable key={key} style={s.card} onPress={() => submit(key)} disabled={pending === key}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{label}</Text>
              <Text style={s.meta}>{status[key] ?? key}</Text>
            </View>
            {pending === key ? <ActivityIndicator color="#12D6AE" /> : <Text style={s.chevron}>›</Text>}
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520" },
  content: { padding: 16, paddingBottom: 80 },
  eyebrow: { color: "#12D6AE", fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginTop: 14 },
  title: { color: "#F5FBFF", fontSize: 27, fontWeight: "900", marginTop: 3 },
  sub: { color: "#748EA1", fontSize: 13, lineHeight: 18, marginTop: 6, marginBottom: 18 },
  card: { minHeight: 70, backgroundColor: "#082536", borderRadius: 16, borderWidth: 1, borderColor: "#17445A", padding: 14, marginBottom: 9, flexDirection: "row", alignItems: "center" },
  label: { color: "#F2F8FC", fontWeight: "800" },
  meta: { color: "#748EA1", fontSize: 10, marginTop: 4 },
  chevron: { color: "#587287", fontSize: 28 }
});

import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { LinqaSendService, type LinqaSendTransferSummary } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { colors, radius, spacing } from "../../theme/tokens";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";

/** SCREEN 14 (Transaction History) — the full real list, not the 5-item
 * preview on the dashboard. */
export default function LinqaSendHistory() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [items, setItems] = useState<LinqaSendTransferSummary[] | null>(null);

  useEffect(() => {
    client
      .listTransfers(100)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [client]);

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={s.back}>←</Text>
        </Pressable>
        <Text style={s.headerTitle}>Transaction History</Text>
      </View>
      {items === null && (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
      {items !== null && items.length === 0 && (
        <View style={s.center}>
          <Text style={s.muted}>No transfers yet.</Text>
        </View>
      )}
      {items !== null && items.length > 0 && (
        <ScrollView contentContainerStyle={s.content}>
          {items.map((t) => (
            <Pressable key={t.id} style={s.row} onPress={() => router.push({ pathname: "/linqasend/status", params: { id: t.id } })}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{t.recipientName}</Text>
                <Text style={s.rowSub}>{new Date(t.createdAt).toLocaleString()}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.rowAmount}>
                  {(Number(t.sendAmountMinor) / 100).toFixed(2)} {t.sendCurrency}
                </Text>
                <Text style={s.rowStatus}>{t.status.replace(/_/g, " ")}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, paddingTop: 52 },
  back: { color: colors.text, fontSize: 20 },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textFaint, fontSize: 13 },
  content: { padding: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  rowTitle: { color: colors.text, fontWeight: "700" },
  rowSub: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
  rowAmount: { color: colors.text, fontWeight: "700", fontSize: 12 },
  rowStatus: { color: colors.textFaint, fontSize: 10, marginTop: 2 }
});

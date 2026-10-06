import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { LinqaSendService, type LinqaSendTransferSummary } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { radius, spacing, useTheme, type Palette } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";

const API = getApiBaseUrl();
const TERMINAL_STATUSES = new Set(["COMPLETED", "DECLINED", "CANCELED", "FAILED", "EXPIRED"]);
type TransferFilter = "ALL" | "IN_PROGRESS" | "COMPLETED";

/** SCREEN 14 (Transaction History) — the full real list, not the 5-item
 * preview on the dashboard. */
export default function LinqaSendHistory() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [items, setItems] = useState<LinqaSendTransferSummary[] | null>(null);
  const [filter, setFilter] = useState<TransferFilter>("ALL");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    try {
      const response = await client.listTransfers(100);
      setItems(response.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load transaction history.");
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  const visibleItems = (items ?? []).filter((item) => {
    if (filter === "COMPLETED") return item.status === "COMPLETED";
    if (filter === "IN_PROGRESS") return !TERMINAL_STATUSES.has(item.status);
    return true;
  });

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={s.back}>←</Text>
        </Pressable>
        <Text style={s.headerTitle}>Transaction History</Text>
      </View>
      <View style={s.filters}>
        {(["ALL", "IN_PROGRESS", "COMPLETED"] as const).map((value) => (
          <Pressable key={value} style={[s.filter, filter === value && s.filterSelected]} onPress={() => setFilter(value)}>
            <Text style={[s.filterText, filter === value && s.filterTextSelected]}>
              {value === "ALL" ? "All" : value === "IN_PROGRESS" ? "In progress" : "Completed"}
            </Text>
          </Pressable>
        ))}
      </View>
      {items === null && (
        <View style={s.center}>
          {error ? <><Text style={s.muted}>{error.replace(/_/g, " ")}</Text><Pressable onPress={() => void load()}><Text style={s.retry}>Try again</Text></Pressable></> : <ActivityIndicator color={colors.accent} />}
        </View>
      )}
      {items !== null && !error && items.length === 0 && (
        <View style={s.center}>
          <Text style={s.muted}>No transfers yet.</Text>
        </View>
      )}
      {items !== null && !error && items.length > 0 && (
        <ScrollView contentContainerStyle={s.content}>
          {visibleItems.length === 0 ? <Text style={s.muted}>No {filter === "COMPLETED" ? "completed" : "in-progress"} transfers.</Text> : visibleItems.map((t) => (
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

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, paddingTop: 52 },
  back: { color: colors.text, fontSize: 20 },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  filters: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  filter: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  filterSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  filterText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  filterTextSelected: { color: "#FFFFFF" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textFaint, fontSize: 13 },
  retry: { color: colors.accent, fontSize: 13, fontWeight: "700", marginTop: spacing.md },
  content: { padding: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  rowTitle: { color: colors.text, fontWeight: "700" },
  rowSub: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  rowAmount: { color: colors.text, fontWeight: "700", fontSize: 12 },
  rowStatus: { color: colors.textFaint, fontSize: 12, marginTop: 2 }
});

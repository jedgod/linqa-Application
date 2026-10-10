import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { TransferRow, transferRoute } from "../../components/linqasend/TransferRow";
import { LinqaSendStatusBar, LinqaSendTabBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService, type LinqaSendTransferSummary } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();
const PAGE = 20;
type Filter = "all" | "sent" | "received";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["sent", "Sent"], ["received", "Received"]];

/** Transaction History: sent and received transfers, newest first, loaded a page at a time. */
export default function LinqaSendHistory() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<LinqaSendTransferSummary[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (which: Filter) => {
    setError(null);
    setItems(null);
    setNextOffset(null);
    try {
      const page = await client.listTransfers(PAGE, { direction: which });
      setItems(page.items);
      setNextOffset(page.nextOffset ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to load transaction history.");
    }
  }, [client]);
  // The filter is the only thing a reload depends on, so a fast switch cannot show another filter's rows.
  useEffect(() => { void load(filter); }, [filter, load]);

  async function loadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await client.listTransfers(PAGE, { direction: filter, offset: nextOffset });
      setItems((current) => {
        const seen = new Set((current ?? []).map((i) => i.id));
        return [...(current ?? []), ...page.items.filter((i) => !seen.has(i.id))];
      });
      setNextOffset(page.nextOffset ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Transaction History</Text>
        <View style={s.headerButton} />
      </View>

      <View style={s.filters} accessibilityRole="tablist">
        {FILTERS.map(([key, label]) => (
          <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: filter === key }} style={[s.pill, filter === key && s.pillOn]} onPress={() => setFilter(key)}>
            <Text style={[s.pillText, filter === key && s.pillTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.list}>
        {error ? (
          <View style={s.errorBox}>
            <Text style={s.error}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load(filter)}><Text style={s.link}>Try again</Text></Pressable>
          </View>
        ) : null}
        {items === null && !error ? <ActivityIndicator color={send.primary} style={{ marginTop: 40 }} /> : null}

        {items?.map((item) => (
          <TransferRow key={`${item.direction}-${item.id}`} item={item} onPress={() => router.push(transferRoute(item))} />
        ))}

        {items !== null && items.length === 0 && !error ? (
          <View style={s.empty}>
            <Ionicons name="receipt-outline" size={42} color={send.faint} />
            <Text style={s.emptyTitle}>{filter === "received" ? "Nothing received yet" : filter === "sent" ? "No transfers sent yet" : "No transactions yet"}</Text>
            <Text style={s.emptyText}>{filter === "received" ? "Money sent to you by other Linqa users will appear here." : "Your transfers will appear here."}</Text>
          </View>
        ) : null}

        {nextOffset !== null ? (
          <Pressable accessibilityRole="button" disabled={loadingMore} style={s.more} onPress={() => void loadMore()}>
            {loadingMore ? <ActivityIndicator color={send.primary} /> : <Text style={s.moreText}>Load More</Text>}
          </Pressable>
        ) : null}
      </ScrollView>
      <LinqaSendTabBar active="activity" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18 },
  filters: { flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  pill: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: send.border, alignItems: "center", justifyContent: "center", backgroundColor: send.bg },
  pillOn: { backgroundColor: send.primary, borderColor: send.primary },
  pillText: { color: send.text, fontFamily: fonts.semibold, fontSize: 15 },
  pillTextOn: { color: "#FFFFFF", fontFamily: fonts.bold },
  list: { paddingHorizontal: 20, paddingBottom: 30 },
  more: { alignItems: "center", justifyContent: "center", minHeight: 64, marginTop: 8 },
  moreText: { color: send.primary, fontFamily: fonts.bold, fontSize: 17 },
  empty: { alignItems: "center", paddingTop: 54, gap: 8, paddingHorizontal: 16 },
  emptyTitle: { color: send.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 6 },
  emptyText: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  errorBox: { backgroundColor: "#FEF3F2", borderRadius: 14, padding: 14, gap: 8, marginTop: 12 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14 },
  link: { color: send.primary, fontFamily: fonts.bold, fontSize: 14 }
});

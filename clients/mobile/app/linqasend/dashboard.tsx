import { displayMoney } from "../../services/send-money-validation";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { TransferRow, transferRoute } from "../../components/linqasend/TransferRow";
import { LinqaSendStatusBar, LinqaSendTabBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService, type LinqaSendTransferSummary } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();

type Totals = Awaited<ReturnType<LinqaSendService["getDashboard"]>>;

/** Dashboard: what you have sent, and your latest transfers. Totals count completed transfers only. */
export default function LinqaSendDashboard() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [recent, setRecent] = useState<LinqaSendTransferSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [summary, transfers] = await Promise.allSettled([client.getDashboard(), client.listTransfers(3)]);
    if (summary.status === "fulfilled") setTotals(summary.value);
    if (transfers.status === "fulfilled") setRecent(transfers.value.items);
    if (summary.status === "rejected" && transfers.status === "rejected") {
      const reason = summary.reason;
      setError(reason instanceof Error ? reason.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to load your dashboard");
    } else if (transfers.status === "rejected") {
      setRecent([]);
    }
  }, [client]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const usd = (minor: string | undefined) => `${displayMoney(minor ?? "0", totals?.currency ?? "USD")} ${totals?.currency ?? "USD"}`;

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <View style={s.headerButton} />
        <Text accessibilityRole="header" style={s.title}>Dashboard</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Requests" style={s.headerButton} onPress={() => router.push("/linqasend/requests")}>
          <Ionicons name="notifications-outline" size={26} color={send.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {error ? (
          <View style={s.errorBox}>
            <Text style={s.error}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={s.link}>Try again</Text></Pressable>
          </View>
        ) : null}

        <View style={s.hero} accessible accessibilityLabel={`Total sent, all time, ${usd(totals?.totalSentMinor)} ${totals?.currency ?? "USD"}`}>
          <Text style={s.heroLabel}>Total Sent (All Time)</Text>
          {totals ? <Text style={s.heroValue}>{usd(totals.totalSentMinor)} <Text style={s.heroCode}>{totals.currency}</Text></Text> : <ActivityIndicator color="#FFFFFF" style={{ alignSelf: "flex-start", marginTop: 12 }} />}
        </View>

        <View style={s.pair}>
          <View style={s.small}>
            <Text style={s.smallLabel}>This Month</Text>
            <Text style={s.smallValue}>{totals ? usd(totals.thisMonthMinor) : "–"}</Text>
          </View>
          <View style={s.small}>
            <Text style={s.smallLabel}>This Week</Text>
            <Text style={s.smallValue}>{totals ? usd(totals.thisWeekMinor) : "–"}</Text>
          </View>
        </View>

        <Text style={s.section}>Recent Activity</Text>
        {recent === null && !error ? <ActivityIndicator color={send.primary} style={{ marginTop: 20 }} /> : null}
        {recent?.length === 0 ? <Text style={s.empty}>No transfers yet. Send your first one to see it here.</Text> : null}
        {recent?.map((item) => (
          <TransferRow key={item.id} item={item} showAvatar onPress={() => router.push(transferRoute(item))} />
        ))}

        <Pressable accessibilityRole="button" style={s.viewAll} onPress={() => router.push("/linqasend/history")}>
          <Text style={s.viewAllText}>View All Transactions</Text>
        </Pressable>
      </ScrollView>
      <LinqaSendTabBar active="home" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 16 },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
  hero: { backgroundColor: send.primary, borderRadius: 18, paddingVertical: 22, paddingHorizontal: 20 },
  heroLabel: { color: "#E3E1FF", fontFamily: fonts.medium, fontSize: 14 },
  heroValue: { color: "#FFFFFF", fontFamily: fonts.extrabold, fontSize: 18, marginTop: 8 },
  heroCode: { fontFamily: fonts.semibold, fontSize: 16 },
  pair: { flexDirection: "row", gap: 14, marginTop: 16 },
  small: { flex: 1, backgroundColor: send.primarySoft, borderRadius: 18, padding: 18 },
  smallLabel: { color: send.primary, fontFamily: fonts.semibold, fontSize: 14 },
  smallValue: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18, marginTop: 10 },
  section: { color: send.text, fontFamily: fonts.extrabold, fontSize: 16, marginTop: 28, marginBottom: 4 },
  empty: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, marginTop: 10 },
  viewAll: { alignItems: "center", paddingVertical: 22 },
  viewAllText: { color: send.primary, fontFamily: fonts.bold, fontSize: 16 },
  errorBox: { backgroundColor: "#FEF3F2", borderRadius: 14, padding: 14, gap: 8, marginBottom: 14 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14 },
  link: { color: send.primary, fontFamily: fonts.bold, fontSize: 14 }
});

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { wallet, WalletHeader, WalletTabBar, moneyText } from "../../components/wallet/theme";
import { getApiBaseUrl } from "../../config/api";
import { WalletService, type WalletMoneyOperation } from "../../services/wallet.service";
import { accessTokenProvider } from "../../services/session";
import { isNetworkError } from "../../services/wallet-errors";
import {
  applyQuery, describeOperation, groupByDate, isBank, isIncoming, periodTotals, STATUS_LABEL, statusKey, summaryCurrency,
  type ActivityFilter, type PeriodFilter, type StatusFilter, type StatusKey
} from "../../services/wallet-activity";
import { fonts } from "../../theme/tokens";
import { formatAmount } from "../../services/wallet-format";
import { useWalletDemo } from "../../services/wallet-demo-mode";
import { useAccounts } from "../../account/AccountContext";

const PAGE = 30;
const MAX_SUMMARY_PAGES = 10;
const money = (minor: string, currency: string) => moneyText(minor, currency);
const FILTERS: Array<[ActivityFilter, string]> = [["ALL", "All"], ["RECEIVED", "Received"], ["SENT", "Sent"], ["BANK", "Bank"]];
const STATUSES: Array<[StatusFilter, string]> = [["ANY", "Any status"], ["COMPLETED", "Completed"], ["PENDING", "Pending"], ["FAILED", "Failed"], ["REVERSED", "Reversed"]];
const PERIODS: Array<[PeriodFilter, string]> = [["ANY", "All time"], ["MONTH", "This month"], ["30D", "Last 30 days"]];
const STATUS_STYLE: Record<StatusKey, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  COMPLETED: { icon: "checkmark-circle", color: wallet.green },
  PENDING: { icon: "time", color: "#F5A524" },
  FAILED: { icon: "close-circle", color: wallet.danger },
  REVERSED: { icon: "return-up-back", color: wallet.danger },
  CANCELED: { icon: "remove-circle", color: wallet.muted }
};

function when(iso: string): string {
  const d = new Date(iso), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === new Date(now.getTime() - 86_400_000).toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

/** Wallet Activity: incoming, outgoing and bank operations, newest first. Everything here comes from the server. */
export default function WalletActivity() {
  const router = useRouter();
  const { active } = useAccounts();
  const userId = active?.userId;
  const demo = useWalletDemo();
  const client = useMemo(() => new WalletService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [items, setItems] = useState<WalletMoneyOperation[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<"offline" | "failed" | null>(null);
  const [moreError, setMoreError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<ActivityFilter>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ANY");
  const [period, setPeriod] = useState<PeriodFilter>("ANY");
  // Results that arrive after the account changed or the screen reloaded must not overwrite newer state.
  const generation = useRef(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    const mine = ++generation.current;
    if (mode === "refresh") setRefreshing(true);
    setError(null); setMoreError(false);
    try {
      let page = await client.operations({ limit: PAGE });
      let all = page.items, next = page.nextCursor, pages = 1;
      // The monthly summary must not silently cover only part of the month: keep reading until the oldest row is before this month.
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
      while (next && pages < MAX_SUMMARY_PAGES && new Date(all.at(-1)!.created_at).getTime() >= monthStart) {
        page = await client.operations({ limit: PAGE, cursor: next });
        all = [...all, ...page.items]; next = page.nextCursor; pages++;
      }
      if (mine !== generation.current) return;
      setItems(all); setCursor(next);
    } catch (e) {
      if (mine === generation.current) setError(isNetworkError(e) ? "offline" : "failed");
    } finally { if (mine === generation.current) setRefreshing(false); }
  }, [client, demo]);

  useFocusEffect(useCallback(() => { void load("initial"); return () => { generation.current++; }; }, [load, userId]));

  // Names for rows are best effort: a failure leaves the generic wording, never a made-up name.
  useEffect(() => {
    let live = true;
    Promise.allSettled([client.targets("INTERNAL"), client.targets("EXTERNAL"), client.targets("WITHDRAW")]).then((results) => {
      if (!live) return;
      const map = new Map<string, string>();
      for (const r of results) if (r.status === "fulfilled") for (const t of r.value.items) map.set(t.id, t.name);
      setNames(map);
    });
    return () => { live = false; };
  }, [client, userId]);

  async function loadOlder() {
    if (!cursor || loadingMore || error) return;
    const mine = generation.current;
    setLoadingMore(true); setMoreError(false);
    try {
      const page = await client.operations({ limit: PAGE, cursor });
      if (mine !== generation.current) return;
      setItems((prev) => [...(prev ?? []), ...page.items]); setCursor(page.nextCursor);
    } catch { if (mine === generation.current) setMoreError(true); } finally { setLoadingMore(false); }
  }

  const query = { filter, status, period, text };
  const visible = useMemo(() => applyQuery(items ?? [], query, names), [items, filter, status, period, text, names]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = useMemo(() => groupByDate(visible).map((g) => ({ title: g.title, data: g.items })), [visible]);
  const currency = useMemo(() => summaryCurrency(items ?? [], null), [items]);
  const totals = useMemo(() => (currency ? periodTotals(items ?? [], currency, "MONTH") : null), [items, currency]);
  const narrowed = filter !== "ALL" || status !== "ANY" || period !== "ANY" || text.trim() !== "";
  const clearAll = () => { setFilter("ALL"); setStatus("ANY"); setPeriod("ANY"); setText(""); };

  const header = (
    <View>
      {totals && currency && totals.count > 0 ? (
        <View style={s.summary} accessibilityLabel="This month's summary">
          <Text style={s.muted}>This month · net</Text>
          <View style={s.netRow}>
            <Text style={s.net} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatAmount(totals.netMinor.toString(), currency)}</Text>
            <Text style={s.netCode}>{currency}</Text>
          </View>
          <View style={s.summarySide}>
            <View style={s.summaryCell}><Text style={s.mutedSmall}>Money In</Text><Text style={[s.sideValue, { color: wallet.teal }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatAmount(totals.inMinor.toString(), currency)} {currency}</Text></View>
            <View style={s.summaryCell}><Text style={s.mutedSmall}>Money Out</Text><Text style={[s.sideValue, { color: wallet.danger }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatAmount(totals.outMinor.toString(), currency)} {currency}</Text></View>
          </View>
          <Text style={s.mutedSmall}>Completed only{cursor ? " · latest activity" : ""}</Text>
        </View>
      ) : null}
      <View style={s.chips}>
        {FILTERS.map(([key, label]) => (
          <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: filter === key }} style={[s.chip, filter === key && s.chipOn]} onPress={() => setFilter(key)}>
            <Text style={[s.chipText, filter === key && { color: wallet.onTeal }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {error && items ? (
        <View style={s.banner}><Ionicons name={error === "offline" ? "cloud-offline-outline" : "alert-circle-outline"} size={20} color={wallet.danger} />
          <Text style={s.bannerText}>{error === "offline" ? "You're offline. Showing what was loaded earlier." : "Couldn't refresh. Showing what was loaded earlier."}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load("refresh")}><Text style={s.link}>Retry</Text></Pressable>
        </View>
      ) : null}
    </View>
  );

  const body = !items && !error ? (
    <View style={s.center}><ActivityIndicator color={wallet.teal} size="large" /><Text style={s.muted}>Loading activity…</Text></View>
  ) : !items && error ? (
    <View style={s.center}>
      <Ionicons name={error === "offline" ? "cloud-offline-outline" : "alert-circle-outline"} size={32} color={wallet.danger} />
      <Text style={s.emptyTitle}>{error === "offline" ? "You're offline" : "Activity is unavailable"}</Text>
      <Text style={s.muted}>{error === "offline" ? "Connect to the internet and try again." : "Something went wrong loading your wallet activity."}</Text>
      <Pressable accessibilityRole="button" style={s.primary} onPress={() => void load("initial")}><Text style={s.primaryText}>Try again</Text></Pressable>
    </View>
  ) : (
    <SectionList
      sections={sections}
      keyExtractor={(op) => op.id}
      ListHeaderComponent={header}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={s.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} tintColor={wallet.teal} colors={[wallet.teal]} />}
      onEndReached={() => void loadOlder()}
      onEndReachedThreshold={0.4}
      renderSectionHeader={({ section }) => <Text style={s.section}>{section.title}</Text>}
      ListEmptyComponent={
        <View style={s.center}>
          <Ionicons name="receipt-outline" size={32} color={wallet.muted} />
          <Text style={s.emptyTitle}>{narrowed ? "No matching activity" : "No activity yet"}</Text>
          <Text style={s.muted}>{narrowed ? "Try a different search or filter." : "Load money or send from your wallet and it will show up here."}</Text>
          {narrowed ? <Pressable accessibilityRole="button" style={s.primary} onPress={clearAll}><Text style={s.primaryText}>Clear filters</Text></Pressable> : null}
        </View>
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator color={wallet.teal} style={{ margin: 16 }} />
          : moreError ? <Pressable accessibilityRole="button" onPress={() => void loadOlder()}><Text style={[s.link, { textAlign: "center", padding: 16 }]}>Couldn't load older activity. Tap to retry.</Text></Pressable>
          : cursor ? <Text style={[s.mutedSmall, { textAlign: "center", padding: 16 }]}>Scroll for older activity</Text> : null
      }
      renderItem={({ item: op, index, section }) => {
        const incoming = isIncoming(op), sk = statusKey(op.status), st = STATUS_STYLE[sk], cur = op.snapshot.currency;
        const color = incoming ? wallet.teal : wallet.danger;
        const amount = incoming ? (op.kind === "TOPUP" ? op.snapshot.receiveAmountMinor : op.snapshot.amountMinor) : op.snapshot.totalMinor;
        const icon: keyof typeof Ionicons.glyphMap = isBank(op) ? "business" : incoming ? "arrow-down" : "arrow-up";
        const description = describeOperation(op, names);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${description}, ${incoming ? "plus" : "minus"} ${money(amount, cur)}, ${STATUS_LABEL[sk]}`}
            style={[s.row, index < section.data.length - 1 && s.rowDivider]}
            onPress={() => router.push({ pathname: "/wallet/transaction", params: { id: op.id } })}
          >
            <View style={[s.rowIcon, { backgroundColor: incoming ? wallet.tealSoft : "#3A1B1F" }]}><Ionicons name={icon} size={20} color={color} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.rowTitle, { color }]} numberOfLines={3}>{description}</Text>
              <Text style={s.muted}>{when(op.created_at)}</Text>
              <View style={s.statusLine}><Ionicons name={st.icon} size={16} color={st.color} /><Text style={[s.status, { color: sk === "COMPLETED" ? wallet.muted : st.color }]}>{STATUS_LABEL[sk]}</Text></View>
            </View>
            <View style={s.amountCol}>
              <Text style={[s.rowAmount, { color }]} numberOfLines={1}>{incoming ? "+" : "-"}{formatAmount(amount, cur)}</Text>
              <Text style={s.amountCode}>{cur}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={wallet.muted} />
          </Pressable>
        );
      }}
    />
  );

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="light" />
      <WalletHeader title="Activity" onBack={() => (router.canGoBack() ? router.back() : router.replace("/wallet"))}>
        <Pressable accessibilityRole="button" accessibilityLabel="Search activity" accessibilityState={{ selected: showSearch }} style={[s.roundButton, showSearch && s.roundButtonOn]} onPress={() => { setShowSearch((v) => !v); if (showSearch) setText(""); }}>
          <Ionicons name="search" size={18} color={wallet.text} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Filter activity" accessibilityState={{ selected: showFilters }} style={[s.roundButton, (showFilters || status !== "ANY" || period !== "ANY") && s.roundButtonOn]} onPress={() => setShowFilters((v) => !v)}>
          <Ionicons name="options" size={18} color={wallet.text} />
        </Pressable>
      </WalletHeader>

      {showSearch ? (
        <View style={s.searchWrap}>
          <Ionicons name="search" size={20} color={wallet.muted} />
          <TextInput accessibilityLabel="Search by recipient or reference" autoFocus value={text} onChangeText={setText} placeholder="Search by recipient or reference" placeholderTextColor={wallet.faint} style={s.searchInput} autoCapitalize="none" autoCorrect={false} />
          {text ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} onPress={() => setText("")}><Ionicons name="close-circle" size={20} color={wallet.muted} /></Pressable> : null}
        </View>
      ) : null}

      {showFilters ? (
        <View style={s.filterPanel}>
          <Text style={s.mutedSmall}>Status</Text>
          <View style={s.chips}>{STATUSES.map(([key, label]) => (
            <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: status === key }} style={[s.chip, status === key && s.chipOn]} onPress={() => setStatus(key)}><Text style={[s.chipText, status === key && { color: wallet.onTeal }]}>{label}</Text></Pressable>
          ))}</View>
          <Text style={s.mutedSmall}>Period</Text>
          <View style={s.chips}>{PERIODS.map(([key, label]) => (
            <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: period === key }} style={[s.chip, period === key && s.chipOn]} onPress={() => setPeriod(key)}><Text style={[s.chipText, period === key && { color: wallet.onTeal }]}>{label}</Text></Pressable>
          ))}</View>
        </View>
      ) : null}

      <View style={{ flex: 1 }}>{body}</View>
      <WalletTabBar active="activity" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wallet.bg },
  roundButton: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: wallet.raised, backgroundColor: wallet.card, alignItems: "center", justifyContent: "center" },
  roundButtonOn: { borderColor: wallet.teal },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 14, marginBottom: 6, paddingHorizontal: 12, minHeight: 40, borderRadius: 10, backgroundColor: wallet.card, borderWidth: 1, borderColor: wallet.raised },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: wallet.text, paddingVertical: 6 },
  filterPanel: { marginHorizontal: 14, marginBottom: 6, padding: 10, gap: 6, borderRadius: 10, backgroundColor: wallet.card, borderWidth: 1, borderColor: wallet.raised },
  listContent: { paddingHorizontal: 14, paddingBottom: 12, flexGrow: 1 },
  summary: { gap: 2, padding: 12, marginBottom: 8, borderRadius: 12, backgroundColor: wallet.card, borderWidth: 1, borderColor: wallet.raised },
  netRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  net: { flexShrink: 1, fontFamily: fonts.extrabold, fontSize: 26, color: wallet.text },
  netCode: { fontFamily: fonts.bold, fontSize: 12, color: wallet.muted },
  summarySide: { flexDirection: "row", gap: 10, paddingVertical: 6, marginVertical: 2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: wallet.raised },
  summaryCell: { flex: 1, gap: 1 },
  amountCol: { alignItems: "flex-end", minWidth: 70 },
  amountCode: { fontFamily: fonts.medium, fontSize: 10, color: wallet.muted },
  sideValue: { fontFamily: fonts.bold, fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 14, minHeight: 34, borderRadius: 999, borderWidth: 1, borderColor: wallet.raised, backgroundColor: wallet.card, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: wallet.teal, borderColor: wallet.teal },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.muted },
  section: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.muted, marginTop: 10, marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, minHeight: 58 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: wallet.raised },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  rowAmount: { fontFamily: fonts.bold, fontSize: 14 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  status: { fontFamily: fonts.medium, fontSize: 12 },
  muted: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: wallet.muted },
  mutedSmall: { fontFamily: fonts.regular, fontSize: 12, color: wallet.muted },
  center: { alignItems: "center", justifyContent: "center", gap: 8, padding: 28, flexGrow: 1 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, color: wallet.text, textAlign: "center" },
  primary: { backgroundColor: wallet.teal, borderRadius: 10, minHeight: 40, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", marginTop: 6 },
  primaryText: { fontFamily: fonts.bold, fontSize: 14, color: wallet.onTeal },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, marginBottom: 6, borderRadius: 10, borderWidth: 1, borderColor: wallet.danger, backgroundColor: wallet.card },
  bannerText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: wallet.text },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal }
});

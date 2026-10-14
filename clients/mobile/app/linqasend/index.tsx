import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAccounts } from "../../account/AccountContext";
import { Avatar, LinqaSendStatusBar, LinqaSendTabBar, greeting, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService, type LinqaSendTransferSummary } from "../../services/linqasend.service";
import { useLinqaSendAvailability } from "../../services/linqasend-availability";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();

const money = (minor: string, currency: string) =>
  `${currency} ${(Number(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS: Record<string, { label: string; color: string }> = {
  COMPLETED: { label: "Completed", color: send.success },
  DECLINED: { label: "Declined", color: send.danger },
  FAILED: { label: "Failed", color: send.danger },
  CANCELED: { label: "Canceled", color: send.muted },
  EXPIRED: { label: "Expired", color: send.muted }
};
const statusOf = (status: string) => STATUS[status] ?? { label: "In progress", color: send.warning };

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export default function LinqaSendHome() {
  const router = useRouter();
  const { active } = useAccounts();
  const available = useLinqaSendAvailability();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [items, setItems] = useState<LinqaSendTransferSummary[] | null>(null);
  const [overview, setOverview] = useState<Awaited<ReturnType<LinqaSendService["getHome"]>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    setSetupError(null);
    setItems(null);
    setOverview(null);
    // Independent: a missing jurisdiction profile fails the overview but must not hide recent activity.
    const [home, transfers] = await Promise.allSettled([client.getHome(), client.listTransfers(5)]);
    if (home.status === "fulfilled") setOverview(home.value);
    else setSetupError(home.reason instanceof Error ? home.reason.message : "Unable to load your overview.");
    if (transfers.status === "fulfilled") setItems(transfers.value.items);
    else setError(transfers.reason instanceof Error ? transfers.reason.message : "Unable to load LinqaSend.");
  }, [client]);

  useEffect(() => { if (available === true) void load(); }, [available, load, refreshKey]);

  if (available !== true) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.unavailable}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"><Ionicons name="chevron-back" size={27} color={send.text} /></Pressable>
          {available === null
            ? <ActivityIndicator style={{ marginTop: 40 }} color={send.primary} />
            : <><Text style={s.brand}>LinqaSend</Text><Text style={s.muted}>Money transfers are not available yet. We will let you know as soon as they launch in your region.</Text></>}
        </View>
      </SafeAreaView>
    );
  }

  const firstName = (active?.displayName ?? "").trim().split(/\s+/)[0] ?? "";
  const incoming = overview?.requests.incoming ?? 0;
  const quickActions = [
    { key: "funding", label: "Add Money", icon: "add-circle-outline" as const, route: "/linqasend/payment-methods" },
    { key: "contacts", label: "Global\nContacts", icon: "people-outline" as const, route: "/linqasend/global-contacts" },
    { key: "transactions", label: "Dashboard", icon: "stats-chart-outline" as const, route: "/linqasend/dashboard" },
    { key: "more", label: "More", icon: "ellipsis-vertical" as const, route: "/linqasend/controls" }
  ];

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View style={s.logoRow}>
            <View style={s.logoMark}><Ionicons name="paper-plane" size={18} color={send.primary} /></View>
            <Text style={s.brand}>LinqaSend</Text>
          </View>
          <Pressable onPress={() => router.replace("/(tabs)/home")} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close LinqaSend" style={{ marginLeft: "auto", marginRight: 10, padding: 4 }}>
            <Ionicons name="close" size={26} color={send.text ?? "#0F172A"} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={incoming ? `Requests, ${incoming} waiting` : "Requests"}
            style={s.bell}
            onPress={() => router.push("/linqasend/requests")}
          >
            <Ionicons name="notifications-outline" size={26} color={send.text} />
            {incoming > 0 ? <View style={s.badge}><Text style={s.badgeText}>{incoming > 9 ? "9+" : incoming}</Text></View> : null}
          </Pressable>
        </View>

        <Text accessibilityRole="header" style={s.greeting}>{greeting()}{firstName ? `, ${firstName}` : ""} 👋</Text>
        <Text style={s.subGreeting}>Move money with transparent rates.</Text>

        {setupError ? (
          <View style={s.setupBox}>
            <Text style={s.setupTitle}>{/jurisdiction/i.test(setupError) ? "Set up your region to start sending" : "Couldn't load your overview"}</Text>
            <Text style={s.muted}>{/jurisdiction/i.test(setupError) ? "LinqaSend needs your country of residence to show the right corridors and limits." : setupError.replace(/_/g, " ")}</Text>
            <Pressable accessibilityRole="button" style={s.setupButton} onPress={() => (/jurisdiction/i.test(setupError) ? router.push("/linqasend/jurisdiction") : setRefreshKey((key) => key + 1))}>
              <Text style={s.setupButtonText}>{/jurisdiction/i.test(setupError) ? "Set up region" : "Try again"}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={s.stats}>
          <View style={s.stat}><Text style={s.statValue}>{overview?.recipientCount ?? "–"}</Text><Text style={s.statLabel}>Saved recipients</Text></View>
          <View style={s.statDivider} />
          <View style={s.stat}><Text style={s.statValue}>{overview?.verifiedFundingSourceCount ?? "–"}</Text><Text style={s.statLabel}>Funding sources</Text></View>
          <View style={s.statDivider} />
          <View style={s.stat}><Text style={s.statValue}>{overview ? overview.requests.incoming + overview.requests.outgoing : "–"}</Text><Text style={s.statLabel}>Open requests</Text></View>
        </View>

        <View style={s.actions}>
          <Pressable accessibilityRole="button" style={s.primary} onPress={() => router.push("/linqasend/send")}>
            <Text style={s.primaryText}>Send Money</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={s.secondary} onPress={() => router.push("/linqasend/receive")}>
            <Text style={s.secondaryText}>Receive Money</Text>
          </Pressable>
        </View>

        <View style={s.banner}>
          <View style={s.bannerCopy}>
            <Text style={s.bannerTitle}>See the rate first</Text>
            <Text style={s.bannerText}>Every quote shows the exchange rate and what your recipient gets before you authorize.</Text>
          </View>
          <Image source={require("../../assets/linqasend-globe.jpg")} style={s.bannerArt} accessibilityIgnoresInvertColors />
        </View>

        <Text style={s.section}>Quick Actions</Text>
        <View style={s.quick}>
          {quickActions.map((action) => (
            <Pressable key={action.key} accessibilityRole="button" accessibilityLabel={action.label.replace("\n", " ")} style={s.quickItem} onPress={() => router.push(action.route as never)}>
              <View style={s.quickIcon}><Ionicons name={action.icon} size={24} color={send.primary} /></View>
              <Text style={s.quickLabel}>{action.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.activityHeader}>
          <Text style={s.section}>Recent Activity</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/linqasend/history")}><Text style={s.link}>View all</Text></Pressable>
        </View>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.error}>{error.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Text>
            <Pressable accessibilityRole="button" onPress={() => setRefreshKey((key) => key + 1)}><Text style={s.link}>Try again</Text></Pressable>
          </View>
        ) : items === null ? (
          <ActivityIndicator color={send.primary} style={{ marginVertical: 24 }} />
        ) : items.length === 0 ? (
          <Text style={s.muted}>No transfers yet. Send your first one to see it here.</Text>
        ) : (
          items.map((item) => {
            const status = statusOf(item.status);
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                style={s.row}
                onPress={() => router.push({ pathname: item.status === "COMPLETED" ? "/linqasend/receipt" : "/linqasend/status", params: { id: item.id } })}
              >
                <Avatar name={item.recipientName} size={46} />
                <View style={s.rowText}>
                  <Text style={s.rowTitle} numberOfLines={1}>To {item.recipientName}</Text>
                  <Text style={s.rowMeta}>{dayLabel(item.createdAt)}</Text>
                </View>
                <View style={s.rowRight}>
                  <Text style={s.rowAmount}>{money(item.receiveAmountMinor, item.receiveCurrency)}</Text>
                  <Text style={[s.rowStatus, { color: status.color }]}>{status.label}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
      <LinqaSendTabBar active="home" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  unavailable: { padding: 20, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: { width: 34, height: 34, borderRadius: 9, borderWidth: 2, borderColor: send.primary, alignItems: "center", justifyContent: "center" },
  brand: { color: send.text, fontFamily: fonts.extrabold, fontSize: 24 },
  bell: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: send.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 11 },
  greeting: { color: send.text, fontFamily: fonts.extrabold, fontSize: 24, marginTop: 20 },
  subGreeting: { color: send.muted, fontFamily: fonts.regular, fontSize: 15, marginTop: 4 },
  stats: { flexDirection: "row", alignItems: "center", backgroundColor: send.surface, borderRadius: 16, paddingVertical: 14, marginTop: 18 },
  stat: { flex: 1, alignItems: "center" },
  statValue: { color: send.text, fontFamily: fonts.extrabold, fontSize: 22 },
  statLabel: { color: send.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: send.border },
  actions: { flexDirection: "row", gap: 12, marginTop: 18 },
  primary: { flex: 1, height: 54, borderRadius: 14, backgroundColor: send.primary, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 },
  secondary: { flex: 1, height: 54, borderRadius: 14, backgroundColor: send.bg, borderWidth: 1.5, borderColor: send.border, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: send.primary, fontFamily: fonts.bold, fontSize: 16 },
  banner: { flexDirection: "row", alignItems: "center", backgroundColor: send.primarySoft, borderRadius: 18, padding: 18, marginTop: 18 },
  bannerCopy: { flex: 1, paddingRight: 10 },
  bannerTitle: { color: send.text, fontFamily: fonts.extrabold, fontSize: 17 },
  bannerText: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 6 },
  bannerArt: { width: 112, height: 112, borderRadius: 56, borderWidth: 3, borderColor: "#FFFFFF" },
  section: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18 },
  quick: { flexDirection: "row", justifyContent: "space-between", marginTop: 14, marginBottom: 6 },
  quickItem: { width: "23%", alignItems: "center" },
  quickIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: send.primarySoft, alignItems: "center", justifyContent: "center" },
  quickLabel: { color: send.text, fontFamily: fonts.medium, fontSize: 12, textAlign: "center", marginTop: 8, lineHeight: 16 },
  activityHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 6 },
  link: { color: send.primary, fontFamily: fonts.bold, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: send.border },
  rowText: { flex: 1 },
  rowTitle: { color: send.text, fontFamily: fonts.bold, fontSize: 15 },
  rowMeta: { color: send.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  rowRight: { alignItems: "flex-end" },
  rowAmount: { color: send.text, fontFamily: fonts.bold, fontSize: 15 },
  rowStatus: { fontFamily: fonts.medium, fontSize: 13, marginTop: 3 },
  muted: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, marginTop: 8 },
  setupBox: { backgroundColor: send.primarySoft, borderRadius: 16, padding: 16, marginTop: 18, gap: 6 },
  setupTitle: { color: send.text, fontFamily: fonts.bold, fontSize: 16 },
  setupButton: { alignSelf: "flex-start", marginTop: 8, height: 44, borderRadius: 12, backgroundColor: send.primary, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  setupButtonText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 14 },
  errorBox: { backgroundColor: "#FEF3F2", borderRadius: 14, padding: 14, gap: 8, marginTop: 6 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14 }
});

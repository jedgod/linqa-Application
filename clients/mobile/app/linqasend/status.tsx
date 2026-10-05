import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinqaSendService, type LinqaSendTransferDetail } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { radius, spacing, useTheme, type Palette } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";

const API = getApiBaseUrl();
const TERMINAL_STATUSES = new Set(["COMPLETED", "DECLINED", "CANCELED", "FAILED", "EXPIRED"]);

/** SCREEN 7 (Transfer Tracking) + SCREEN 15 (Receipt): real status polling
 * against the transfer's actual state and attempt timeline, not a fake
 * animated progress bar. */
export default function LinqaSendStatus() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [transfer, setTransfer] = useState<LinqaSendTransferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function cancel() {
    try { await client.cancelTransfer(params.id); setTransfer(await client.getTransfer(params.id)); setActionMessage("Transfer canceled."); }
    catch (e) { setActionMessage(e instanceof Error ? e.message.replace(/_/g, " ") : "Unable to cancel transfer."); }
  }

  async function refund() {
    try { await client.requestRefund(params.id, "CUSTOMER_REQUEST"); setActionMessage("Refund request submitted for operations approval."); }
    catch (e) { setActionMessage(e instanceof Error ? e.message.replace(/_/g, " ") : "Unable to request refund."); }
  }

  useEffect(() => {
    let stopped = false;
    async function poll() {
      while (!stopped) {
        try {
          const detail = await client.getTransfer(params.id);
          if (stopped) return;
          setTransfer(detail);
          if (TERMINAL_STATUSES.has(detail.status) || detail.status === "MANUAL_REVIEW") return;
        } catch (e) {
          setError(e instanceof Error ? e.message : "Unable to load this transfer.");
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    poll();
    return () => {
      stopped = true;
    };
  }, [client, params.id]);

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={() => router.replace("/linqasend")} accessibilityLabel="Close">
          <Text style={s.back}>✕</Text>
        </Pressable>
        <Text style={s.headerTitle}>Transfer {params.id}</Text>
      </View>
      {!transfer && !error && (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
      {error && (
        <View style={s.center}>
          <Text style={s.muted}>{error}</Text>
        </View>
      )}
      {transfer && (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.card}>
            <Text style={s.status}>{transfer.status.replace(/_/g, " ")}</Text>
            <Text style={s.amount}>
              {(Number(transfer.sendAmountMinor) / 100).toFixed(2)} {transfer.sendCurrency} → {(Number(transfer.receiveAmountMinor) / 100).toFixed(2)}{" "}
              {transfer.receiveCurrency}
            </Text>
            <Text style={s.sub}>To {transfer.recipientName}</Text>
            {transfer.failureCode && <Text style={s.failure}>Reason: {transfer.failureCode.replace(/_/g, " ").toLowerCase()}</Text>}
            {actionMessage && <Text style={s.actionMessage}>{actionMessage}</Text>}
            {["CREATED","QUOTE_CREATED","AWAITING_CONFIRMATION","REQUIRES_ACTION"].includes(transfer.status) && <Pressable style={s.actionButton} onPress={cancel}><Text style={s.actionButtonText}>Cancel transfer</Text></Pressable>}
            {transfer.status === "COMPLETED" && <Pressable style={s.actionButton} onPress={refund}><Text style={s.actionButtonText}>Request refund</Text></Pressable>}
          </View>

          <Text style={s.sectionTitle}>Timeline</Text>
          {transfer.timeline.length === 0 && <Text style={s.muted}>No provider attempts recorded yet at this stage.</Text>}
          {transfer.timeline.map((t, i) => (
            <View key={i} style={s.timelineRow}>
              <Text style={s.timelinePhase}>{t.phase.replace(/_/g, " ")}</Text>
              <Text style={s.timelineStatus}>{t.status}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, paddingTop: 52 },
  back: { color: colors.text, fontSize: 18 },
  headerTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textFaint, fontSize: 13 },
  content: { padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  status: { color: colors.accent, fontWeight: "900", fontSize: 16 },
  amount: { color: colors.text, fontWeight: "800", fontSize: 20, marginTop: spacing.sm },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs },
  failure: { color: colors.danger, fontSize: 12, marginTop: spacing.sm },
  actionMessage: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
  actionButton: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: "center", marginTop: spacing.md },
  actionButtonText: { color: colors.accent, fontWeight: "800", fontSize: 12 },
  sectionTitle: { color: colors.text, fontWeight: "800", marginBottom: spacing.sm },
  timelineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  timelinePhase: { color: colors.text, fontSize: 12, fontWeight: "700" },
  timelineStatus: { color: colors.textFaint, fontSize: 12 }
});

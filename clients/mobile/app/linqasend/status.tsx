import { pollPaymentStatus } from "../../services/payment-status-polling";
import { displayMoney } from "../../services/send-money-validation";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService, type LinqaSendTransferDetail } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { TrackingTimeline } from "../../components/linqasend/TrackingTimeline";
import { trackTransfer } from "../../services/transfer-tracking";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();
const TERMINAL_STATUSES = new Set(["COMPLETED", "DECLINED", "CANCELED", "FAILED", "EXPIRED", "REVERSED", "REFUNDED"]);
const CANCELABLE = new Set(["CREATED", "QUOTE_CREATED", "AWAITING_CONFIRMATION", "REQUIRES_ACTION"]);

/** Transfer Tracking: real status polling, shown as the five-step timeline. */
export default function LinqaSendStatus() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [transfer, setTransfer] = useState<LinqaSendTransferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => { if (state === "active") setRetry(value => value + 1); });
    return () => subscription.remove();
  }, []);

  async function cancel() {
    try { await client.cancelTransfer(params.id); setTransfer(await client.getTransfer(params.id)); setNote("Transfer canceled."); }
    catch (e) { setNote(e instanceof Error ? e.message.replace(/_/g, " ") : "Unable to cancel transfer."); }
  }

  async function refund() {
    try { await client.requestRefund(params.id, "CUSTOMER_REQUEST"); setNote("Refund request submitted for operations approval."); }
    catch (e) { setNote(e instanceof Error ? e.message.replace(/_/g, " ") : "Unable to request refund."); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void pollPaymentStatus({
      signal: controller.signal,
      load: () => client.getTransfer(params.id),
      onValue: detail => { setTransfer(detail); setError(null); },
      onError: () => setError("Unable to refresh payment status. Reconnecting?"),
      terminal: detail => TERMINAL_STATUSES.has(detail.status) || detail.status === "MANUAL_REVIEW"
    });
    return () => controller.abort();
  }, [client, params.id, retry]);

  const tracking = useMemo(
    () => (transfer ? trackTransfer({ status: transfer.status, createdAt: transfer.createdAt, completedAt: transfer.completedAt, timeline: transfer.timeline, failureCode: transfer.failureCode }) : null),
    [transfer]
  );

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.headerButton} onPress={() => router.replace("/linqasend")}>
          <Ionicons name="close" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>{tracking?.title ?? "Transfer"}</Text>
        <View style={s.headerButton} />
      </View>

      {!transfer && !error ? <View style={s.center}><ActivityIndicator color={send.primary} /></View> : null}
      {error ? (
        <View style={s.center}>
          <Text style={s.muted}>{error}</Text>
          <Text style={s.muted}>Connection trouble does not mean the payment failed.</Text>
          <Pressable accessibilityRole="button" style={{ marginTop: 14 }} onPress={() => { setError(null); setRetry(value => value + 1); }}><Text style={s.link}>Retry status check</Text></Pressable>
          <Pressable accessibilityRole="button" style={{ marginTop: 14 }} onPress={() => router.replace("/linqasend")}><Text style={s.link}>Back to LinqaSend</Text></Pressable>
        </View>
      ) : null}

      {transfer && tracking ? (
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.summary}>
            {displayMoney(transfer.sendAmountMinor, transfer.sendCurrency)} {transfer.sendCurrency} → {displayMoney(transfer.receiveAmountMinor, transfer.receiveCurrency)} {transfer.receiveCurrency} to {transfer.recipientName}
          </Text>

          <TrackingTimeline steps={tracking.steps} />

          <View style={s.messageCard}>
            <Text style={s.message}>{tracking.message}</Text>
            {transfer.failureCode && tracking.outcome === "STOPPED" ? <Text style={s.reason}>Reason: {transfer.failureCode.replace(/_/g, " ").toLowerCase()}</Text> : null}
          </View>

          {note ? <Text style={s.note}>{note}</Text> : null}
          <View style={s.actions}>
            {CANCELABLE.has(transfer.status) ? <Pressable accessibilityRole="button" style={s.actionButton} onPress={cancel}><Text style={s.actionText}>Cancel transfer</Text></Pressable> : null}
            {transfer.status === "COMPLETED" ? <Pressable accessibilityRole="button" style={s.actionButton} onPress={refund}><Text style={s.actionText}>Request refund</Text></Pressable> : null}
            <Pressable accessibilityRole="button" style={s.primary} onPress={() => router.replace("/linqasend")}><Text style={s.primaryText}>Done</Text></Pressable>
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  muted: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, textAlign: "center" },
  link: { color: send.primary, fontFamily: fonts.bold, fontSize: 15 },
  content: { paddingHorizontal: 28, paddingTop: 8, paddingBottom: 32 },
  summary: { color: send.muted, fontFamily: fonts.medium, fontSize: 14, textAlign: "center", marginBottom: 26 },
  messageCard: { backgroundColor: send.surface, borderRadius: 16, paddingVertical: 24, paddingHorizontal: 20, marginTop: 20 },
  message: { color: send.text, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24, textAlign: "center" },
  reason: { color: send.danger, fontFamily: fonts.medium, fontSize: 13, textAlign: "center", marginTop: 10 },
  note: { color: send.muted, fontFamily: fonts.medium, fontSize: 13, textAlign: "center", marginTop: 14 },
  actions: { marginTop: 18, gap: 10 },
  actionButton: { height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: send.border, alignItems: "center", justifyContent: "center" },
  actionText: { color: send.primary, fontFamily: fonts.bold, fontSize: 15 },
  primary: { height: 54, borderRadius: 16, backgroundColor: send.primary, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 }
});

import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { wallet, WalletHeader, WalletTabBar, moneyText } from "../../components/wallet/theme";
import { getApiBaseUrl } from "../../config/api";
import { WalletService, type WalletMoneyOperation } from "../../services/wallet.service";
import { GaHardeningService } from "../../services/ga-hardening.service";
import { accessTokenProvider } from "../../services/session";
import { isNetworkError, walletErrorText } from "../../services/wallet-errors";
import { describeOperation, isIncoming, STATUS_LABEL, statusKey } from "../../services/wallet-activity";
import { fonts } from "../../theme/tokens";
import { useWalletDemo } from "../../services/wallet-demo-mode";
import { useAccounts } from "../../account/AccountContext";

const money = (minor: string, currency: string) => moneyText(minor, currency);
const KIND_LABEL = { TOPUP: "Added money", WITHDRAW: "Cash out", INTERNAL: "Wallet transfer", EXTERNAL: "Payment outside Linqa" } as const;
const STATUS_COLOR = { COMPLETED: wallet.green, PENDING: "#F5A524", FAILED: wallet.danger, REVERSED: wallet.danger, CANCELED: wallet.muted } as const;

/** Receipt for one wallet operation, with the reference, its status, and a way to report a problem. */
export default function WalletTransaction() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useAccounts();
  const userId = active?.userId;
  const demo = useWalletDemo();
  const client = useMemo(() => new WalletService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [op, setOp] = useState<WalletMoneyOperation | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<"offline" | "missing" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let live = true;
    setError(null);
    (async () => {
      try {
        const found = await client.operation(String(id));
        if (!live) return;
        setOp(found);
        // Best-effort extras; the receipt is complete without them.
        client.note(found.id).then((n) => { if (live) setNote(n); }).catch(() => undefined);
        const kind = found.kind === "TOPUP" ? null : found.kind;
        if (kind && found.direction === "SENT") client.targets(kind).then((r) => { if (live) setName(r.items.find((t) => t.id === found.snapshot.targetId)?.name ?? null); }).catch(() => undefined);
      } catch (e) {
        if (!live) return;
        setError(isNetworkError(e) ? "offline" : e instanceof Error && e.message === "WALLET_OPERATION_NOT_FOUND" ? "missing" : "failed");
      }
    })();
    return () => { live = false; };
  }, [client, id, reload, userId, demo]));

  async function run(work: () => Promise<unknown>, done: string, fail: string) {
    if (busy) return;
    setBusy(true); setNotice("");
    try { await work(); setNotice(done); setReload((v) => v + 1); } catch (e) { setNotice(walletErrorText(e, fail)); } finally { setBusy(false); }
  }

  function reportProblem() {
    if (!op) return;
    Alert.alert("Report a problem", "This opens a support case with this transaction's reference attached.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Open case", onPress: () => void run(async () => {
          const support = new GaHardeningService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
          const result: any = await support.createSupportCase({
            category: "Billing", priority: "NORMAL", subject: "Wallet transaction problem",
            description: `Problem reported from Wallet transaction details. Reference ${op.id}; ${KIND_LABEL[op.kind]}; status ${op.status}; ${money(op.snapshot.amountMinor, op.snapshot.currency)}.`
          });
          setNotice(result?.case_number ? `Support case #${result.case_number} opened.` : "Support case opened.");
        }, "", "We couldn't open a support case. Try again.")
      }
    ]);
  }

  async function copyReference() {
    if (!op) return;
    await Clipboard.setStringAsync(op.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const header = <WalletHeader title="Details" onBack={() => (router.canGoBack() ? router.back() : router.replace("/wallet/activity"))} />;

  if (!op) {
    return (
      <SafeAreaView style={s.screen}>
        <StatusBar style="light" />
        {header}
        <View style={s.center}>
          {error ? (
            <>
              <Ionicons name={error === "offline" ? "cloud-offline-outline" : "alert-circle-outline"} size={44} color={wallet.danger} />
              <Text style={s.emptyTitle}>{error === "offline" ? "You're offline" : error === "missing" ? "Transaction not found" : "Details are unavailable"}</Text>
              <Text style={s.muted}>{error === "missing" ? "It may belong to another account." : "Check your connection and try again."}</Text>
              {error !== "missing" ? <Pressable accessibilityRole="button" style={s.primary} onPress={() => setReload((v) => v + 1)}><Text style={s.primaryText}>Try again</Text></Pressable> : null}
            </>
          ) : <ActivityIndicator color={wallet.teal} size="large" />}
        </View>
        <WalletTabBar active="activity" />
      </SafeAreaView>
    );
  }

  const incoming = isIncoming(op), sk = statusKey(op.status), cur = op.snapshot.currency;
  const color = incoming ? wallet.teal : wallet.danger;
  const amount = incoming ? (op.kind === "TOPUP" ? op.snapshot.receiveAmountMinor : op.snapshot.amountMinor) : op.snapshot.totalMinor;
  const names = new Map(name ? [[op.snapshot.targetId, name]] : []);
  const rows: Array<[string, string]> = [
    ["Type", KIND_LABEL[op.kind]],
    ["Date", new Date(op.created_at).toLocaleString()],
    ...(incoming ? [] : [["Amount", money(op.snapshot.amountMinor, cur)] as [string, string], ["Fee", BigInt(op.snapshot.feeMinor) === 0n ? "Free" : money(op.snapshot.feeMinor, cur)] as [string, string]]),
    ...(op.snapshot.receiveCurrency !== cur ? [["Recipient gets", money(op.snapshot.receiveAmountMinor, op.snapshot.receiveCurrency)] as [string, string], ["Rate", op.snapshot.fxRate] as [string, string]] : []),
    ...(BigInt(op.returned_minor) > 0n ? [["Returned", money(op.returned_minor, cur)] as [string, string]] : [])
  ];

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="light" />
      {header}
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <Text style={[s.heroAmount, { color }]}>{incoming ? "+" : "-"}{money(amount, cur)}</Text>
          <Text style={s.heroTitle}>{describeOperation(op, names)}</Text>
          <View style={s.statusPill}><View style={[s.dot, { backgroundColor: STATUS_COLOR[sk] }]} /><Text style={[s.statusText, { color: STATUS_COLOR[sk] }]}>{STATUS_LABEL[sk]}</Text></View>
          {sk === "PENDING" ? <Text style={s.muted}>Still being processed. Its status updates here when the provider confirms.</Text> : null}
        </View>

        <View style={s.card}>
          {rows.map(([label, value], i) => (
            <View key={label} style={[s.line, i > 0 && s.lineDivider]}><Text style={s.muted}>{label}</Text><Text style={s.value}>{value}</Text></View>
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel="Copy reference" style={[s.line, s.lineDivider]} onPress={() => void copyReference()}>
            <Text style={s.muted}>Reference</Text>
            <View style={s.reference}><Text style={s.value} numberOfLines={1}>…{op.id.slice(-12).toUpperCase()}</Text><Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={wallet.teal} /></View>
          </Pressable>
          {note ? <View style={[s.line, s.lineDivider]}><Text style={s.muted}>Private note</Text><Text style={s.value}>{note}</Text></View> : null}
        </View>
        {note ? <Text style={s.mutedSmall}>Your private note is saved on this device only.</Text> : null}

        {op.action_url ? (
          <Pressable accessibilityRole="button" style={s.secondary} onPress={() => void Linking.openURL(op.action_url!)}><Text style={s.secondaryText}>Complete secure provider verification</Text></Pressable>
        ) : null}
        {op.status === "QUEUED" ? (
          <Pressable accessibilityRole="button" disabled={busy} style={s.secondary} onPress={() => void run(() => client.cancelOperation(op.id), "Canceled before processing.", "Cancellation could not be confirmed.")}>
            <Text style={s.secondaryText}>Cancel before processing</Text>
          </Pressable>
        ) : null}
        {op.status === "COMPLETED" && (op.kind === "WITHDRAW" || op.kind === "EXTERNAL") ? (
          <Pressable accessibilityRole="button" disabled={busy} style={s.secondary} onPress={() => void run(() => client.requestRefund(op.id), "Return requested. Funds are credited only when the provider confirms their return.", "The return request could not be confirmed.")}>
            <Text style={s.secondaryText}>Request return of payment</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" disabled={busy} style={[s.primary, busy && { opacity: 0.5 }]} onPress={reportProblem}>
          <Ionicons name="flag-outline" size={20} color={wallet.onTeal} /><Text style={s.primaryText}>Report a problem</Text>
        </Pressable>
        {notice ? <Text accessibilityRole="alert" style={s.notice}>{notice}</Text> : null}
      </ScrollView>
      <WalletTabBar active="activity" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wallet.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  title: { fontFamily: fonts.bold, fontSize: 28, color: wallet.text },
  content: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 10, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  hero: { alignItems: "center", gap: 4, paddingVertical: 4 },
  heroAmount: { fontFamily: fonts.extrabold, fontSize: 32, letterSpacing: -0.5 },
  heroTitle: { fontFamily: fonts.semibold, fontSize: 15, color: wallet.text, textAlign: "center" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: wallet.card },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontFamily: fonts.semibold, fontSize: 13 },
  card: { backgroundColor: wallet.card, borderRadius: 14, borderWidth: 1, borderColor: wallet.raised, paddingHorizontal: 14 },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, minHeight: 36 },
  lineDivider: { borderTopWidth: 1, borderTopColor: wallet.raised },
  value: { fontFamily: fonts.semibold, fontSize: 14, color: wallet.text, flexShrink: 1, textAlign: "right" },
  reference: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  muted: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: wallet.muted },
  mutedSmall: { fontFamily: fonts.regular, fontSize: 13, color: wallet.muted },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 20, color: wallet.text, textAlign: "center" },
  primary: { flexDirection: "row", gap: 10, backgroundColor: wallet.teal, borderRadius: 10, minHeight: 44, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  primaryText: { fontFamily: fonts.bold, fontSize: 14, color: wallet.onTeal },
  secondary: { borderWidth: 1, borderColor: wallet.teal, borderRadius: 10, minHeight: 42, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal },
  notice: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, color: wallet.text }
});

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { currencySymbol, wallet, WalletHeader, WalletTabBar } from "../../components/wallet/theme";
import { QrCode } from "../../components/wallet/QrCode";
import { getApiBaseUrl } from "../../config/api";
import { WalletService, type WalletBalance } from "../../services/wallet.service";
import { accessTokenProvider } from "../../services/session";
import { isNetworkError, walletFailure, type WalletFailure } from "../../services/wallet-errors";
import { estimateFee, type FeeSchedules } from "../../services/wallet-fees";
import { formatAmount } from "../../services/wallet-format";
import { parseMoney } from "../../services/send-money-validation";
import { invoicePayload, maskInvoiceCode, type WalletInvoice } from "../../services/wallet-stealthpay";
import { useWalletDemo } from "../../services/wallet-demo-mode";
import { fonts } from "../../theme/tokens";
import { useAccounts } from "../../account/AccountContext";

const TTL_SECONDS = 900;

/**
 * Request money into the wallet with a one-time invoice QR. The requester receives exactly the amount entered; the
 * payer's fee is added on top and priced by the server when they pay, the same as every other wallet transfer. The
 * fee card here is a preview from the read-only fee schedule.
 */
export default function WalletRequestMoney() {
  const router = useRouter();
  const { active } = useAccounts();
  const userId = active?.userId;
  const demo = useWalletDemo();
  const owner = useRef(userId);
  owner.current = userId;
  const client = useMemo(() => new WalletService(getApiBaseUrl(), async () => {
    const token = await accessTokenProvider.getAccessToken();
    if (!userId || owner.current !== userId) throw new Error("Account changed. Reopen your wallet.");
    return token;
  }), [userId]);

  const [available, setAvailable] = useState<boolean | null>(null);
  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [schedules, setSchedules] = useState<FeeSchedules | null>(null);
  const [amount, setAmount] = useState("");
  const [invoice, setInvoice] = useState<WalletInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WalletFailure | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setAvailable(null);
    Promise.allSettled([client.services(), client.fees(), client.balances()]).then(([services, fees, balances]) => {
      if (!live) return;
      setAvailable(services.status === "fulfilled" && services.value.services.includes("stealthpay"));
      setSchedules(fees.status === "fulfilled" ? fees.value.schedules : null);
      setWallets(balances.status === "fulfilled" ? balances.value.items.filter((w) => w.status === "ACTIVE") : []);
    });
    return () => { live = false; };
  }, [client, demo]);

  const w = wallets[0];
  const minor = w ? parseMoney(amount.trim(), w.currency) : null;
  const estimate = w ? estimateFee(schedules, "INTERNAL", w.currency, minor) : null;
  const invalid = amount.trim() !== "" && !minor;
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/wallet"));

  async function create() {
    if (!w || !minor) return;
    setBusy(true); setFailure(null); setMessage("");
    try {
      const created = await client.createInvoice({ currency: w.currency, amountMinor: minor, ttlSeconds: TTL_SECONDS });
      if (owner.current !== userId) return;
      setInvoice(created);
    } catch (e) {
      if (owner.current !== userId) return;
      if (isNetworkError(e)) setMessage("You're offline. Connect to the internet and try again.");
      else setFailure(walletFailure(e, "We couldn't create this request."));
    } finally { setBusy(false); }
  }

  function again() { setInvoice(null); setAmount(""); setCopied(false); setFailure(null); setMessage(""); }
  async function copyCode() {
    if (!invoice) return;
    await Clipboard.setStringAsync(invoice.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function shareRequest() {
    if (!invoice) return;
    const total = estimate ? ` (${formatAmount(estimate.totalMinor.toString(), invoice.currency)} ${invoice.currency} with the fee)` : "";
    const until = new Date(invoice.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    // The code is a one-time bearer token: whoever receives it can pay this invoice once, until it expires.
    try { await Share.share({ message: `Please pay my Linqa request for ${formatAmount(invoice.baseAmountMinor, invoice.currency)} ${invoice.currency}${total}. One-time code, valid until ${until}:
${invoicePayload(invoice.code)}` }); } catch { /* the user closed the share sheet */ }
  }

  const header = (
    <WalletHeader title="Request Money" onBack={goBack}>
      <Ionicons name="shield-checkmark-outline" size={22} color={wallet.teal} />
    </WalletHeader>
  );
  const feeCard = (base: string, currency: string, fee: bigint | null, total: bigint | null, minimumApplied: boolean) => (
    <View style={s.card} accessibilityLabel="Fee schedule">
      <Text style={s.eyebrowTeal}>Fee schedule</Text>
      <View style={s.line}><Text style={s.lineLabel}>You receive</Text><Text style={s.value}>{formatAmount(base, currency)}</Text></View>
      <View style={s.line}><Text style={s.lineLabel}>Platform fee (added for the payer)</Text><Text style={s.value}>{fee === null ? "-" : formatAmount(fee.toString(), currency)}</Text></View>
      {fee !== null ? <View style={s.badge}><Text style={s.badgeText}>{minimumApplied ? "Minimum fee applied" : "10% internal transfer fee applied"}</Text></View> : null}
      <View style={s.totalLine}>
        <Text style={s.totalLabel}>Payer pays</Text>
        <Text style={s.totalValue}>{total === null ? "-" : formatAmount(total.toString(), currency)} <Text style={s.totalCode}>{currency}</Text></Text>
      </View>
    </View>
  );

  if (available === null) return <Shell>{header}<View style={s.center}><ActivityIndicator color={wallet.teal} size="large" /></View></Shell>;
  if (!available || !w) {
    return (
      <Shell>{header}
        <View style={s.center}>
          <Ionicons name="shield-outline" size={32} color={wallet.muted} />
          <Text style={s.emptyTitle}>{available ? "No active wallet" : "Requests aren't available yet"}</Text>
          <Text style={[s.muted, { textAlign: "center" }]}>{available ? "Open a wallet before requesting money." : "One-time requests aren't offered for your account right now."}</Text>
          <Pressable accessibilityRole="button" style={s.primary} onPress={() => router.replace("/wallet")}><Text style={s.primaryText}>Back to Wallet</Text></Pressable>
        </View>
      </Shell>
    );
  }

  return (
    <Shell>{header}
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {invoice ? (
          <>
            <View style={s.card}>
              <Text style={s.eyebrow}>Amount requested</Text>
              <Text style={s.amountDone}>{formatAmount(invoice.baseAmountMinor, invoice.currency)} <Text style={s.totalCode}>{invoice.currency}</Text></Text>
            </View>
            {feeCard(invoice.baseAmountMinor, invoice.currency, estimate?.feeMinor ?? null, estimate?.totalMinor ?? null, estimate?.minimumApplied === true)}
            <View style={[s.card, { alignItems: "center", paddingVertical: 10 }]}><QrCode payload={invoicePayload(invoice.code)} size={156} /></View>
            <Text style={s.qrLabel}>One-time request</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Copy request code" style={[s.card, s.tokenRow]} onPress={() => void copyCode()}>
              <Text style={s.token}>{maskInvoiceCode(invoice.code)}</Text>
              <View style={s.copy}><Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={wallet.teal} /><Text style={s.copyText}>{copied ? "Copied" : "Copy"}</Text></View>
            </Pressable>
            <Text style={s.mutedSmall}>Expires at {new Date(invoice.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. The payer sees the exact total before they confirm.</Text>
            <Pressable accessibilityRole="button" style={s.primary} onPress={() => void shareRequest()}><Ionicons name="share-outline" size={18} color={wallet.onTeal} /><Text style={s.primaryText}>Share request</Text></Pressable>
            <Pressable accessibilityRole="button" style={s.secondary} onPress={again}><Text style={s.secondaryText}>New request</Text></Pressable>
          </>
        ) : (
          <>
            <View style={s.card}>
              <Text style={s.eyebrow}>Amount ({w.currency})</Text>
              <View style={s.amountRow}>
                <Text style={s.amountSymbol}>{currencySymbol(w.currency)}</Text>
                <TextInput accessibilityLabel="Amount" keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={wallet.faint} value={amount}
                  onChangeText={(v) => { setFailure(null); setMessage(""); setAmount(v); }} style={[s.amountInput, invalid ? { color: wallet.danger } : null]} />
              </View>
              <Text style={invalid ? s.error : s.mutedSmall}>{invalid ? "Enter an amount like 25.00." : "Enter the amount to request."}</Text>
            </View>
            {feeCard(minor ?? "0", w.currency, estimate?.feeMinor ?? null, estimate?.totalMinor ?? null, estimate?.minimumApplied === true)}
            {message ? <Text accessibilityRole="alert" style={s.error}>{message}</Text> : null}
            {failure ? (
              <View accessibilityRole="alert" style={s.failure}>
                <Text style={s.failureTitle}>{failure.message}</Text>
                {failure.fix ? <Text style={s.muted}>{failure.fix}</Text> : null}
              </View>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !minor }} disabled={busy || !minor} style={[s.primary, (busy || !minor) && s.disabled]} onPress={() => void create()}>
              {busy ? <ActivityIndicator color={wallet.onTeal} /> : <Text style={s.primaryText}>Create Request</Text>}
            </Pressable>
          </>
        )}
        <View style={s.privacy}>
          <Ionicons name="shield-checkmark-outline" size={22} color={wallet.teal} />
          <View style={{ flex: 1 }}>
            <Text style={s.privacyTitle}>One-time request code.</Text>
            <Text style={s.mutedSmall}>It can be paid once and expires in 15 minutes. It shows no account details. The payment still appears in wallet activity.</Text>
          </View>
        </View>
      </ScrollView>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <SafeAreaView style={s.screen}><StatusBar style="light" />{children}<WalletTabBar active="wallet" /></SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wallet.bg },
  content: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 10, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 28 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, color: wallet.text, textAlign: "center" },
  card: { backgroundColor: wallet.card, borderColor: wallet.raised, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  eyebrow: { fontFamily: fonts.medium, fontSize: 12, color: wallet.muted },
  eyebrowTeal: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8, color: wallet.teal, textTransform: "uppercase" },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 4, borderBottomWidth: 1, borderBottomColor: wallet.raised },
  amountSymbol: { fontFamily: fonts.extrabold, fontSize: 28, color: wallet.teal },
  amountInput: { flex: 1, fontFamily: fonts.extrabold, fontSize: 28, color: wallet.teal, paddingVertical: 2 },
  amountDone: { fontFamily: fonts.extrabold, fontSize: 28, color: wallet.teal },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  lineLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: wallet.text },
  value: { fontFamily: fonts.semibold, fontSize: 14, color: wallet.text },
  badge: { alignSelf: "flex-start", borderWidth: 1, borderColor: wallet.tealDeep, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, color: wallet.teal },
  totalLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", borderTopWidth: 1, borderTopColor: wallet.raised, paddingTop: 8 },
  totalLabel: { fontFamily: fonts.bold, fontSize: 14, color: wallet.text },
  totalValue: { fontFamily: fonts.extrabold, fontSize: 22, color: wallet.teal },
  totalCode: { fontFamily: fonts.medium, fontSize: 12, color: wallet.muted },
  qrLabel: { fontFamily: fonts.medium, fontSize: 12.5, color: wallet.teal, textAlign: "center" },
  tokenRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  token: { fontFamily: "monospace", fontSize: 14, color: wallet.muted },
  copy: { flexDirection: "row", alignItems: "center", gap: 6 },
  copyText: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal },
  muted: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: wallet.muted },
  mutedSmall: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, color: wallet.muted },
  error: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: wallet.danger },
  primary: { flexDirection: "row", gap: 8, backgroundColor: wallet.teal, borderRadius: 10, minHeight: 44, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  primaryText: { fontFamily: fonts.bold, fontSize: 14, color: wallet.onTeal },
  secondary: { borderWidth: 1, borderColor: wallet.teal, borderRadius: 10, minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal },
  disabled: { opacity: 0.5 },
  privacy: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: wallet.card, borderColor: wallet.raised, borderWidth: 1, borderRadius: 12, padding: 10 },
  privacyTitle: { fontFamily: fonts.semibold, fontSize: 12.5, color: wallet.text },
  failure: { backgroundColor: wallet.card, borderColor: wallet.danger, borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  failureTitle: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: wallet.text }
});

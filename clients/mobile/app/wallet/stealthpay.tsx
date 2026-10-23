import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { wallet, WalletHeader, WalletTabBar } from "../../components/wallet/theme";
import { QrCode } from "../../components/wallet/QrCode";
import { getApiBaseUrl } from "../../config/api";
import { WalletService, type WalletBalance, type WalletMoneyQuote } from "../../services/wallet.service";
import { accessTokenProvider } from "../../services/session";
import { isNetworkError, walletFailure, type WalletFailure } from "../../services/wallet-errors";
import { estimateFee, type FeeSchedules } from "../../services/wallet-fees";
import { formatAmount } from "../../services/wallet-format";
import { invoicePayload, maskInvoiceCode, parseInvoiceInput, type WalletInvoice } from "../../services/wallet-stealthpay";
import { DEMO_INVOICE_CODE } from "../../services/wallet-demo";
import { walletDemoAvailable, useWalletDemo } from "../../services/wallet-demo-mode";
import { fonts } from "../../theme/tokens";
import { useAccounts } from "../../account/AccountContext";

// Codes the invoice service answers with. They are specific to this screen, so they live here rather than in the shared wallet error list.
const INVOICE_ERRORS: Record<string, string> = {
  INVOICE_NOT_FOUND: "We couldn't find that invoice. Check the code and try again.",
  INVOICE_ALREADY_PAID: "This invoice has already been paid.",
  INVOICE_EXPIRED: "This invoice has expired. Ask for a new one.",
  INVOICE_OWN: "This is your own invoice. Someone else needs to pay it."
};
const money = (minor: string, currency: string) => `${formatAmount(minor, currency)} ${currency}`;

/**
 * Pay a merchant's one-time invoice from the wallet: scan or enter its code, review the server's price, then authorize.
 * The invoice code is a single-use reference. It is not an account number, and the payment is recorded in wallet activity
 * like any other, so nothing on this screen claims the payment is hidden or unlinked.
 */
export default function WalletStealthPay() {
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
  const [stage, setStage] = useState<"entry" | "invoice" | "done">("entry");
  const [text, setText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const [invoice, setInvoice] = useState<WalletInvoice | null>(null);
  const [quote, setQuote] = useState<WalletMoneyQuote | null>(null);
  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [schedules, setSchedules] = useState<FeeSchedules | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<WalletFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ id: string; status: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // One key per invoice lookup, so a retry after a timeout replays the same quote instead of creating a second.
  const attempt = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    setAvailable(null);
    Promise.allSettled([client.services(), client.fees(), client.pending()]).then(([services, fees, hasPending]) => {
      if (!live) return;
      setAvailable(services.status === "fulfilled" && services.value.services.includes("stealthpay"));
      setSchedules(fees.status === "fulfilled" ? fees.value.schedules : null);
      setPending(hasPending.status === "fulfilled" && !!hasPending.value);
    });
    return () => { live = false; };
  }, [client, demo]);

  function reset() { attempt.current = null; scanned.current = false; setInvoice(null); setQuote(null); setMessage(""); setFailure(null); setStage("entry"); }
  const goBack = () => (stage === "invoice" && !pending ? reset() : router.canGoBack() ? router.back() : router.replace("/wallet"));

  async function resolve(raw: string) {
    const code = parseInvoiceInput(raw);
    if (!code) { setMessage("That isn't a LinqaStealthPay invoice code."); scanned.current = false; return; }
    setBusy(true); setMessage(""); setFailure(null); setScanning(false);
    try {
      attempt.current ??= `wallet-invoice-${Crypto.randomUUID()}`;
      const found = await client.lookupInvoice(code);
      const [q, balances] = await Promise.all([client.invoiceQuote(found.id, attempt.current), client.balances()]);
      if (owner.current !== userId) return;
      setInvoice(found); setQuote(q); setWallets(balances.items); setStage("invoice");
    } catch (e) {
      if (owner.current !== userId) return;
      scanned.current = false; attempt.current = null;
      const code2 = e instanceof Error ? e.message : "";
      if (INVOICE_ERRORS[code2]) setMessage(INVOICE_ERRORS[code2]);
      else if (isNetworkError(e)) setMessage("You're offline. Connect to the internet and try again.");
      else setFailure(walletFailure(e, "We couldn't prepare this invoice."));
    } finally { setBusy(false); }
  }

  async function startScan() {
    if (!permission?.granted && !(await requestPermission()).granted) { setMessage("Camera access is needed to scan an invoice QR. You can enter the code instead."); return; }
    scanned.current = false; setMessage(""); setScanning(true);
  }

  async function authorize(mode: "authorize" | "resume" | "resolve" = "authorize") {
    setBusy(true); setFailure(null); setMessage("");
    try {
      const r = mode === "resolve" ? await client.resolvePending() : mode === "resume" ? await client.resume() : await client.authorize(quote!.id);
      if (owner.current !== userId) return;
      attempt.current = null; setPending(false); setDone(r); setStage("done");
    } catch (e) {
      if (owner.current !== userId) return;
      setFailure(isNetworkError(e) ? { code: null, message: "We couldn't reach the server.", fix: "Check your connection." } : walletFailure(e, "Unable to confirm."));
      // After a failed submit the outcome may be unknown: keep the action locked until its status is checked.
      setPending(!!(await client.pending().catch(() => null)));
    } finally { setBusy(false); }
  }

  async function copyCode() {
    if (!invoice) return;
    await Clipboard.setStringAsync(invoice.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const wallet0 = quote ? wallets.find((w) => w.id === quote.walletId) : undefined;
  const short = !!quote && !!wallet0 && BigInt(quote.totalMinor) > BigInt(wallet0.availableMinor);
  const expired = !!quote && Date.parse(quote.expiresAt) <= Date.now();
  const minimumApplied = quote ? estimateFee(schedules, "INTERNAL", quote.currency, quote.amountMinor)?.minimumApplied === true : false;

  const header = (
    <WalletHeader title="Stealth Invoice Pay" onBack={goBack}>
      <Ionicons name="shield-checkmark-outline" size={22} color={wallet.teal} />
    </WalletHeader>
  );
  const failureCard = failure ? (
    <View accessibilityRole="alert" style={s.failure}>
      <Text style={s.failureTitle}>{failure.message}</Text>
      {failure.fix ? <Text style={s.muted}>{failure.fix}</Text> : null}
    </View>
  ) : null;

  if (available === null) return <Shell>{header}<View style={s.center}><ActivityIndicator color={wallet.teal} size="large" /></View></Shell>;
  if (!available) {
    return (
      <Shell>{header}
        <View style={s.center}>
          <Ionicons name="shield-outline" size={32} color={wallet.muted} />
          <Text style={s.emptyTitle}>LinqaStealthPay isn't available yet</Text>
          <Text style={[s.muted, { textAlign: "center" }]}>One-time invoice payments aren't offered for your account right now.</Text>
          <Pressable accessibilityRole="button" style={s.primary} onPress={() => router.replace("/wallet")}><Text style={s.primaryText}>Back to Wallet</Text></Pressable>
        </View>
      </Shell>
    );
  }

  if (stage === "done" && done && invoice && quote) {
    const completed = done.status === "COMPLETED";
    return (
      <Shell>{header}
        <ScrollView contentContainerStyle={s.content}>
          <View style={[s.card, { alignItems: "center" }]}>
            <View style={[s.check, { borderColor: completed ? wallet.teal : "#F5A524" }]}><Ionicons name={completed ? "checkmark" : "time"} size={28} color={completed ? wallet.teal : "#F5A524"} /></View>
            <Text style={s.cardTitle}>{completed ? "Invoice paid" : "Payment in progress"}</Text>
            <Text style={s.muted}>{completed ? `${money(quote.amountMinor, quote.currency)} was paid to ${invoice.merchantName}.` : `Your payment to ${invoice.merchantName} is being processed.`}</Text>
            <Pressable accessibilityRole="button" style={[s.primary, { alignSelf: "stretch" }]} onPress={() => router.replace({ pathname: "/wallet/transaction", params: { id: done.id } })}><Text style={s.primaryText}>View details</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.replace("/wallet")}><Text style={s.link}>Back to Wallet</Text></Pressable>
          </View>
        </ScrollView>
      </Shell>
    );
  }

  if (stage === "invoice" && invoice && quote) {
    return (
      <Shell>{header}
        <ScrollView contentContainerStyle={s.content}>
          {pending ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>We're checking your last payment</Text>
              <Text style={s.muted}>We couldn't confirm its result. Don't pay again until its status is checked.</Text>
              <Pressable accessibilityRole="button" disabled={busy} style={[s.primary, busy && s.disabled]} onPress={() => void authorize("resolve")}><Text style={s.primaryText}>Check status</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void authorize("resume")}><Text style={s.link}>Resume the payment</Text></Pressable>
            </View>
          ) : (
            <>
              <Text style={s.eyebrow}>One-time invoice code</Text>
              <View style={[s.card, { alignItems: "center", paddingVertical: 10 }]}>
                <QrCode payload={invoicePayload(invoice.code)} size={156} />
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Copy invoice code" style={[s.card, s.tokenRow]} onPress={() => void copyCode()}>
                <Text style={s.token}>{maskInvoiceCode(invoice.code)}</Text>
                <Ionicons name={copied ? "checkmark" : "copy-outline"} size={20} color={wallet.teal} />
              </Pressable>

              <View style={s.card} accessibilityLabel="Fee schedule">
                <Text style={s.eyebrowTeal}>Fee schedule</Text>
                <View style={s.line}><Text style={s.lineLabel}>Merchant base amount</Text><Text style={s.value}>{formatAmount(quote.amountMinor, quote.currency)}</Text></View>
                <View style={s.line}><Text style={s.lineLabel}>Platform fee</Text><Text style={s.value}>{formatAmount(quote.feeMinor, quote.currency)}</Text></View>
                <View style={s.badge}><Text style={s.badgeText}>{minimumApplied ? "Minimum fee applied" : "10% internal transfer fee applied"}</Text></View>
                <View style={s.totalLine}>
                  <Text style={s.totalLabel}>Total debit</Text>
                  <Text style={s.totalValue}>{formatAmount(quote.totalMinor, quote.currency)} <Text style={s.totalCode}>{quote.currency}</Text></Text>
                </View>
              </View>
              <Text style={s.mutedSmall}>To {invoice.merchantName}. {expired ? "This quote expired." : `Quote valid until ${new Date(quote.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`}</Text>
              {short ? <Text accessibilityRole="alert" style={s.error}>Your available balance doesn't cover this total.</Text> : null}
              {failureCard}

              {expired ? (
                <Pressable accessibilityRole="button" style={s.primary} onPress={() => { reset(); void resolve(invoice.code); }}><Text style={s.primaryText}>Refresh quote</Text></Pressable>
              ) : (
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || short }} disabled={busy || short} style={[s.primary, s.green, (busy || short) && s.disabled]} onPress={() => void authorize()}>
                  {busy ? <ActivityIndicator color={wallet.text} /> : <><Ionicons name="finger-print" size={20} color={wallet.text} /><Text style={s.greenText}>Authorize Secure Transfer</Text></>}
                </Pressable>
              )}
              <View style={s.privacy}>
                <Ionicons name="shield-checkmark-outline" size={22} color={wallet.teal} />
                <View style={{ flex: 1 }}>
                  <Text style={s.privacyTitle}>The QR holds a one-time invoice code.</Text>
                  <Text style={s.mutedSmall}>It doesn't show your account details. The payment still appears in your wallet activity.</Text>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </Shell>
    );
  }

  return (
    <Shell>{header}
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {pending ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>We're checking your last payment</Text>
            <Text style={s.muted}>We couldn't confirm its result. Don't pay again until its status is checked.</Text>
            <Pressable accessibilityRole="button" disabled={busy} style={[s.primary, busy && s.disabled]} onPress={() => void authorize("resolve")}><Text style={s.primaryText}>Check status</Text></Pressable>
          </View>
        ) : null}
        <View style={s.card}>
          <Text style={s.cardTitle}>Pay an invoice</Text>
          <Text style={s.muted}>Scan the merchant's invoice QR or enter its code. You'll see the full price before you confirm.</Text>
          {scanning ? (
            <View style={s.camera}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => { if (scanned.current) return; scanned.current = true; void resolve(data); }}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Close scanner" hitSlop={10} style={s.closeScan} onPress={() => setScanning(false)}><Ionicons name="close" size={18} color={wallet.text} /></Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" disabled={busy} style={[s.primary, busy && s.disabled]} onPress={() => void startScan()}>
              <Ionicons name="qr-code-outline" size={18} color={wallet.onTeal} /><Text style={s.primaryText}>Scan invoice QR</Text>
            </Pressable>
          )}
          <Text style={s.eyebrow}>Or enter the code</Text>
          <TextInput accessibilityLabel="Invoice code" value={text} onChangeText={(v) => { setText(v); setMessage(""); }} placeholder="inv_…" placeholderTextColor={wallet.faint} autoCapitalize="none" autoCorrect={false} style={s.input} />
          <Pressable accessibilityRole="button" disabled={busy || !text.trim()} style={[s.secondary, (busy || !text.trim()) && s.disabled]} onPress={() => void resolve(text)}>
            {busy ? <ActivityIndicator color={wallet.teal} /> : <Text style={s.secondaryText}>Look up invoice</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push("/wallet/request" as never)}><Text style={s.link}>Request money instead</Text></Pressable>
          {walletDemoAvailable && demo ? <Pressable accessibilityRole="button" onPress={() => void resolve(DEMO_INVOICE_CODE)}><Text style={s.link}>Use the sample invoice (demo)</Text></Pressable> : null}
        </View>
        {message ? <Text accessibilityRole="alert" style={s.error}>{message}</Text> : null}
        {failureCard}
        <View style={s.privacy}>
          <Ionicons name="shield-checkmark-outline" size={22} color={wallet.teal} />
          <View style={{ flex: 1 }}>
            <Text style={s.privacyTitle}>Invoice codes are single-use.</Text>
            <Text style={s.mutedSmall}>A code identifies one invoice, not an account. Payments still appear in your wallet activity.</Text>
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
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, color: wallet.text },
  eyebrow: { fontFamily: fonts.medium, fontSize: 12, color: wallet.muted },
  eyebrowTeal: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8, color: wallet.teal, textTransform: "uppercase" },
  tokenRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  token: { fontFamily: "monospace", fontSize: 14, color: wallet.muted },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  lineLabel: { fontFamily: fonts.regular, fontSize: 13, color: wallet.text },
  value: { fontFamily: fonts.semibold, fontSize: 14, color: wallet.text },
  badge: { alignSelf: "flex-start", borderWidth: 1, borderColor: wallet.tealDeep, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.medium, fontSize: 11, color: wallet.teal },
  totalLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", borderTopWidth: 1, borderTopColor: wallet.raised, paddingTop: 8 },
  totalLabel: { fontFamily: fonts.bold, fontSize: 14, color: wallet.text },
  totalValue: { fontFamily: fonts.extrabold, fontSize: 22, color: wallet.text },
  totalCode: { fontFamily: fonts.medium, fontSize: 12, color: wallet.muted },
  muted: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: wallet.muted },
  mutedSmall: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, color: wallet.muted },
  error: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: wallet.danger },
  primary: { flexDirection: "row", gap: 8, backgroundColor: wallet.teal, borderRadius: 10, minHeight: 44, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  primaryText: { fontFamily: fonts.bold, fontSize: 14, color: wallet.onTeal },
  green: { backgroundColor: "#1F9D6B" },
  greenText: { fontFamily: fonts.bold, fontSize: 14, color: wallet.text },
  secondary: { borderWidth: 1, borderColor: wallet.teal, borderRadius: 10, minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal },
  disabled: { opacity: 0.5 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: wallet.teal, paddingVertical: 4 },
  input: { fontFamily: "monospace", fontSize: 14, color: wallet.text, borderWidth: 1, borderColor: wallet.raised, borderRadius: 8, paddingHorizontal: 12, minHeight: 40 },
  camera: { height: 220, borderRadius: 10, overflow: "hidden", backgroundColor: "#000" },
  closeScan: { position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  check: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  privacy: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: wallet.card, borderColor: wallet.raised, borderWidth: 1, borderRadius: 12, padding: 10 },
  privacyTitle: { fontFamily: fonts.semibold, fontSize: 12.5, color: wallet.text },
  failure: { backgroundColor: wallet.card, borderColor: wallet.danger, borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  failureTitle: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: wallet.text }
});

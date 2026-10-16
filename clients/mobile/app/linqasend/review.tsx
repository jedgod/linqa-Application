import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, LinqaSendStatusBar, countryName, currencyFlag, deliveryLabel, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendApiError, LinqaSendService, type LinqaSendQuote, type LinqaSendSecurityWarning, type PreparedLinqaSendTransfer } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { requestTransactionAuth } from "../../services/transaction-auth";
import { fonts } from "../../theme/tokens";
import { createBiometricClient } from "../../services/biometric-session";
import { displayMoney, parseReviewQuote } from "../../services/send-money-validation";

const API = getApiBaseUrl();

function secondsRemaining(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

type Method = { id: string; type: string; last4: string | null; verificationStatus: string };
const METHOD_NAME: Record<string, string> = { DEBIT_CARD: "Debit card", CREDIT_CARD: "Credit card", BANK_ACCOUNT: "Bank account", MOBILE_WALLET: "Mobile wallet" };

/**
 * Review & Confirm: the disclosed-rate screen. It shows the exact amount, rate and fees
 * before the person authorizes. Confirming first asks for biometrics or the transfer PIN
 * on this device; only then is the device key used to sign and submit the transfer.
 */
export default function LinqaSendReview() {
  const router = useRouter();
  const params = useLocalSearchParams<{ quote: string }>();
  const quote = useMemo(() => parseReviewQuote(params.quote), [params.quote]);
  if (!quote) return <SafeAreaView style={s.screen}><LinqaSendStatusBar /><View style={s.content}><Text style={s.title}>Start a new quote</Text><Text style={s.error}>This payment link is incomplete or invalid. No money was sent.</Text><Pressable accessibilityRole="button" onPress={() => router.replace("/linqasend/send")}><Text style={s.link}>Choose recipient and amount</Text></Pressable></View></SafeAreaView>;
  return <ValidReview key={quote.id} quote={quote} />;
}

function ValidReview({ quote }: { quote: LinqaSendQuote }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ quote: string; recipientName: string; recipientCountry?: string; recipientType?: string; purposeCode?: string; paymentMethodId?: string }>();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);

  const [remaining, setRemaining] = useState(() => secondsRemaining(quote.expiresAt));
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<Method[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ transferId: string; status: string; reason?: string; action?: string } | null>(null);
  const [pending, setPending] = useState<PreparedLinqaSendTransfer | null>(null);
  const [warnings, setWarnings] = useState<LinqaSendSecurityWarning[]>([]);
  const [reconciled, setReconciled] = useState(false);
  useEffect(() => {
    let current = true;
    client.resolvePaymentIntent(quote.id).then(intent => {
      if (!current) return;
      if (intent.transferId) router.replace({ pathname: "/linqasend/status", params: { id: intent.transferId } });
      else setReconciled(true);
    }).catch(() => { if (current) setError("Payment status could not be checked. Reopen this review when connected; do not start a duplicate payment."); });
    return () => { current = false; };
  }, [client, quote.id, router]);

  useEffect(() => {
    const timer = setInterval(() => setRemaining(secondsRemaining(quote.expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [quote.expiresAt]);

  useEffect(() => {
    client
      .listPaymentMethods()
      .then((r) => {
        const methods = r.items.filter(item => item.verificationStatus === "VERIFIED");
        setPaymentMethods(methods);
        // The method chosen on the Select Payment Method step wins; otherwise the first on file.
        const chosen = methods.find((item) => item.id === params.paymentMethodId);
        if (chosen ?? methods[0]) setPaymentMethodId((chosen ?? methods[0])!.id);
      })
      .catch(() => setPaymentMethods([]));
  }, [client, params.paymentMethodId]);

  const sendFee = BigInt(quote.senderFeeMinor ?? 0);
  const recipientFee = BigInt(quote.recipientFeeMinor ?? 0);
  const total = BigInt(quote.sendAmountMinor) + sendFee;
  const method = (paymentMethods ?? []).find((m) => m.id === paymentMethodId) ?? null;

  async function confirm() {
    if (!paymentMethodId || busy || !reconciled) return;
    setBusy(true);
    setError(null);
    try {
      await client.rememberPaymentReview({ ...params, quote: JSON.stringify(quote), recipientName: params.recipientName ?? "Recipient" }, quote.id);
      let prepared = pending;
      if (!prepared) {
        // The production signer prompts on the transaction-bound hardware key itself.
        const strong = (await createBiometricClient(() => accessTokenProvider.getAccessToken()).available()).strong;
        if (!strong) {
          if (!__DEV__) throw new Error("Strong biometric signing is required. Rebuild the app and enroll device biometrics.");
          const auth = await requestTransactionAuth({ amountLabel: `${displayMoney(quote.sendAmountMinor, quote.sendCurrency)} ${quote.sendCurrency}`, recipientName: params.recipientName });
          if (auth !== "AUTHORIZED") return;
        }
        prepared = await client.prepareTransferConfirmation({ quoteId: quote.id, paymentMethodId, ...(params.purposeCode ? { purposeCode: params.purposeCode } : {}) });
        setPending(prepared);
      }
      const outcome = await client.submitPreparedTransfer(prepared, warnings.map((warning) => warning.code));
      // Authorized and submitted: go straight to tracking. Only a refusal needs this screen to explain itself.
      if (outcome.status === "DECLINED") setResult(outcome);
      else router.replace({ pathname: "/linqasend/status", params: { id: outcome.transferId } });
    } catch (e) {
      if (e instanceof LinqaSendApiError && typeof e.payload.transferId === "string") {
        router.replace({ pathname: "/linqasend/status", params: { id: e.payload.transferId } });
        return;
      }
      if (e instanceof LinqaSendApiError && e.payload.error === "scam_warning_acknowledgement_required" && Array.isArray(e.payload.warnings)) {
        setWarnings(e.payload.warnings as LinqaSendSecurityWarning[]);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message.replace(/_/g, " ").toLowerCase() : "Unable to create this transfer.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const good = result.status === "COMPLETED";
    const bad = result.status === "DECLINED";
    return (
      <SafeAreaView style={s.screen}>
        <LinqaSendStatusBar />
        <View style={s.resultBox}>
          <View style={[s.resultIcon, { backgroundColor: good ? "#ECFDF3" : bad ? "#FEF3F2" : send.primarySoft }]}>
            <Ionicons name={good ? "checkmark-circle" : bad ? "close-circle" : "time"} size={54} color={good ? send.success : bad ? send.danger : send.primary} />
          </View>
          <Text style={s.resultTitle}>{result.status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Text>
          {result.reason ? <Text style={s.resultSub}>Reason: {result.reason.replace(/_/g, " ").toLowerCase()}</Text> : null}
          {result.status === "MANUAL_REVIEW" ? (
            <Text style={s.resultSub}>This transfer is held for manual review. No live compliance provider is connected in this environment, so transfers never clear automatically.</Text>
          ) : null}
          <Pressable accessibilityRole="button" style={[s.confirm, { alignSelf: "stretch", marginTop: 28 }]} onPress={() => router.replace({ pathname: "/linqasend/status", params: { id: result.transferId } })}>
            <Text style={s.confirmText}>Track Transfer</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={{ marginTop: 14, padding: 10 }} onPress={() => router.replace("/linqasend")}>
            <Text style={s.link}>Back to LinqaSend</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const disabled = busy || !reconciled || !paymentMethodId || remaining === 0;

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Review & Confirm</Text>
        <View style={s.headerButton} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.label}>You Send</Text>
        <View style={s.moneyCard}>
          <Text style={s.flag}>{currencyFlag(quote.sendCurrency)}</Text>
          <Text style={s.moneyValue}>{displayMoney(quote.sendAmountMinor, quote.sendCurrency)}</Text>
          <Text style={s.moneyCode}>{quote.sendCurrency}</Text>
        </View>

        <Text style={[s.label, { marginTop: 16 }]}>They Receive</Text>
        <View style={s.moneyCard}>
          <Text style={s.flag}>{currencyFlag(quote.receiveCurrency)}</Text>
          <Text style={s.moneyValue}>{displayMoney(quote.receiveAmountMinor, quote.receiveCurrency)}</Text>
          <Text style={s.moneyCode}>{quote.receiveCurrency}</Text>
        </View>

        <Text style={[s.label, { marginTop: 18 }]}>To</Text>
        <View style={s.toRow}>
          <Avatar name={params.recipientName} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={s.toName}>{params.recipientName}</Text>
            <Text style={s.toMeta}>{[params.recipientCountry ? countryName(params.recipientCountry) : "", params.recipientType ? deliveryLabel(params.recipientType) : ""].filter(Boolean).join(" • ") || `Receives in ${quote.receiveCurrency}`}</Text>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.line}><Text style={s.lineLabel}>Exchange rate</Text><Text style={s.lineValue}>1 {quote.sendCurrency} = {Number(quote.customerRate).toFixed(4)} {quote.receiveCurrency}</Text></View>
        <View style={s.line}><Text style={s.lineLabel}>Transfer fee</Text><Text style={s.lineValue}>{displayMoney(sendFee, quote.sendCurrency)} {quote.sendCurrency}</Text></View>
        <View style={s.line}><Text style={s.lineLabel}>Recipient fee</Text><Text style={s.lineValue}>{displayMoney(recipientFee, quote.receiveCurrency)} {quote.receiveCurrency}</Text></View>
        <View style={s.line}><Text style={s.totalLabel}>Total to be charged</Text><Text style={s.totalValue}>{displayMoney(total, quote.sendCurrency)} {quote.sendCurrency}</Text></View>
        <View style={s.line}>
          <Text style={s.lineLabel}>Paid with</Text>
          {paymentMethods === null ? <ActivityIndicator color={send.primary} /> : method ? (
            <Text style={s.lineValue}>{METHOD_NAME[method.type] ?? method.type.replace(/_/g, " ")}{method.last4 ? ` •••• ${method.last4}` : ""}</Text>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => router.push("/linqasend/payment-methods")}><Text style={s.link}>Add a payment method</Text></Pressable>
          )}
        </View>
        <Text style={[s.lock, remaining === 0 && { color: send.danger }]}>
          {remaining === 0 ? "This rate expired. Go back to get a new one." : `Rate locked for ${remaining}s`}
        </Text>

        <View style={s.banner}>
          <View style={s.bannerIcon}><Ionicons name="shield-checkmark-outline" size={22} color={send.success} /></View>
          <Text style={s.bannerText}>No separate fees. The rate includes our disclosed margin.</Text>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}

        {warnings.length > 0 ? (
          <View style={s.warningCard} accessibilityRole="alert">
            <Text style={s.warningTitle}>Pause and verify before sending</Text>
            {warnings.map((warning) => <Text key={warning.code} style={s.warningText}>• {warning.code.replace(/_/g, " ").toLowerCase()}</Text>)}
            <Text style={s.warningText}>Only continue if you know the recipient and nobody is pressuring you to send money.</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={s.footer}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} style={[s.confirm, disabled && { opacity: 0.45 }]} onPress={confirm}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.confirmText}>{remaining === 0 ? "Quote expired" : warnings.length ? "I understand, send money" : "Confirm & Continue"}</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 16 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
  label: { color: send.text, fontFamily: fonts.bold, fontSize: 15, marginBottom: 10 },
  moneyCard: { flexDirection: "row", alignItems: "center", gap: 14, height: 70, borderRadius: 16, borderWidth: 1.5, borderColor: send.border, paddingHorizontal: 16 },
  flag: { fontSize: 18 },
  moneyValue: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18 },
  moneyCode: { color: send.muted, fontFamily: fonts.semibold, fontSize: 15, marginTop: 6 },
  toRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  toName: { color: send.text, fontFamily: fonts.bold, fontSize: 16 },
  toMeta: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 4 },
  divider: { height: 1, backgroundColor: send.border, marginVertical: 20 },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  lineLabel: { color: send.muted, fontFamily: fonts.medium, fontSize: 15 },
  lineValue: { color: send.text, fontFamily: fonts.semibold, fontSize: 15 },
  totalLabel: { color: send.text, fontFamily: fonts.bold, fontSize: 16 },
  totalValue: { color: send.text, fontFamily: fonts.extrabold, fontSize: 16 },
  lock: { color: send.primary, fontFamily: fonts.semibold, fontSize: 13, marginBottom: 14 },
  banner: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#ECFDF3", borderWidth: 1, borderColor: "#BFEBD0", borderRadius: 14, padding: 14, marginTop: 4 },
  bannerIcon: { width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, borderColor: send.success, alignItems: "center", justifyContent: "center" },
  bannerText: { flex: 1, color: "#067647", fontFamily: fonts.semibold, fontSize: 14 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 14 },
  warningCard: { backgroundColor: "#FFFAEB", borderColor: "#F5C451", borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 14 },
  warningTitle: { color: send.warning, fontFamily: fonts.extrabold, fontSize: 15, marginBottom: 6 },
  warningText: { color: send.text, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, backgroundColor: send.bg },
  confirm: { height: 56, borderRadius: 16, backgroundColor: send.primary, alignItems: "center", justifyContent: "center" },
  confirmText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 },
  link: { color: send.primary, fontFamily: fonts.bold, fontSize: 15 },
  resultBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  resultIcon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  resultTitle: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18, marginTop: 20 },
  resultSub: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 10 }
});

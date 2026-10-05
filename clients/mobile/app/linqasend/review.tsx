import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinqaSendApiError, LinqaSendService, type LinqaSendQuote, type LinqaSendSecurityWarning, type PreparedLinqaSendTransfer } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { colors, radius, spacing } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";

const API = getApiBaseUrl();

function money(minor: string, currency: string): string {
  return `${(Number(minor) / 100).toFixed(2)} ${currency}`;
}

function secondsRemaining(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

/** SCREEN 5 (Review & Confirm) — the disclosed-rate screen the pack's own
 * implementation notes require: exact receive amount and rate shown before
 * confirmation, never described as "free exchange." */
export default function LinqaSendReview() {
  const router = useRouter();
  const params = useLocalSearchParams<{ quote: string; recipientName: string; purposeCode?: string }>();
  const quote: LinqaSendQuote = useMemo(() => JSON.parse(params.quote), [params.quote]);
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);

  const [remaining, setRemaining] = useState(() => secondsRemaining(quote.expiresAt));
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<Array<{ id: string; type: string; last4: string | null }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ transferId: string; status: string; reason?: string; action?: string } | null>(null);
  const [pending, setPending] = useState<PreparedLinqaSendTransfer | null>(null);
  const [warnings, setWarnings] = useState<LinqaSendSecurityWarning[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setRemaining(secondsRemaining(quote.expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [quote.expiresAt]);

  useEffect(() => {
    client
      .listPaymentMethods()
      .then((r) => {
        setPaymentMethods(r.items);
        if (r.items[0]) setPaymentMethodId(r.items[0].id);
      })
      .catch(() => setPaymentMethods([]));
  }, [client]);

  async function confirm() {
    if (!paymentMethodId) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = pending ?? await client.prepareTransferConfirmation({ quoteId: quote.id, paymentMethodId, ...(params.purposeCode ? { purposeCode: params.purposeCode } : {}) });
      setPending(prepared);
      const outcome = await client.submitPreparedTransfer(prepared, warnings.map((warning) => warning.code));
      setResult(outcome);
    } catch (e) {
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
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.resultBox}>
          <Text style={s.resultIcon}>{result.status === "COMPLETED" ? "✅" : result.status === "DECLINED" ? "⛔" : "🕓"}</Text>
          <Text style={s.resultTitle}>{result.status.replace(/_/g, " ")}</Text>
          {result.reason && <Text style={s.resultSub}>Reason: {result.reason.replace(/_/g, " ").toLowerCase()}</Text>}
          {result.status === "MANUAL_REVIEW" && (
            <Text style={s.resultSub}>
              This transfer is held for manual review — no live compliance/KYC provider is connected in this environment, so
              transfers never auto-clear.
            </Text>
          )}
          <Pressable style={s.button} onPress={() => router.push({ pathname: "/linqasend/status", params: { id: result.transferId } })}>
            <Text style={s.buttonText}>Track Transfer</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={s.back}>←</Text>
        </Pressable>
        <Text style={s.headerTitle}>Review & Confirm</Text>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.card}>
          <View style={s.rateRow}>
            <Text style={s.bigAmount}>{money(quote.sendAmountMinor, quote.sendCurrency)}</Text>
            <Text style={s.arrow}>→</Text>
            <Text style={s.bigAmount}>{money(quote.receiveAmountMinor, quote.receiveCurrency)}</Text>
          </View>
          <Text style={s.rateDetail}>
            1 {quote.sendCurrency} = {Number(quote.customerRate).toFixed(4)} {quote.receiveCurrency} (includes disclosed FX
            spread — no separate sender/recipient fee)
          </Text>
          <Text style={s.rateDetail}>To: {params.recipientName}</Text>
          <Text style={s.expiry}>Rate locked for {remaining}s</Text>
        </View>

        <Text style={s.sectionTitle}>Funding Source</Text>
        {paymentMethods === null && <ActivityIndicator color={colors.accent} />}
        {paymentMethods !== null && paymentMethods.length === 0 && (
          <View style={s.card}>
            <Text style={s.muted}>No funding source on file.</Text>
            <Pressable style={s.linkButton} onPress={() => router.push("/linqasend/payment-methods")}>
              <Text style={s.linkButtonText}>Add a funding source</Text>
            </Pressable>
          </View>
        )}
        {(paymentMethods ?? []).map((pm) => (
          <Pressable key={pm.id} style={[s.card, s.pmRow, paymentMethodId === pm.id && s.pmRowSelected]} onPress={() => setPaymentMethodId(pm.id)}>
            <Text style={s.pmText}>
              {pm.type.replace(/_/g, " ")} {pm.last4 ? `•••• ${pm.last4}` : ""}
            </Text>
            {paymentMethodId === pm.id && <Text style={s.pmCheck}>✓</Text>}
          </Pressable>
        ))}

        {error && <Text style={s.error}>{error}</Text>}

        {warnings.length > 0 && (
          <View style={s.warningCard} accessibilityRole="alert">
            <Text style={s.warningTitle}>Pause and verify before sending</Text>
            {warnings.map((warning) => (
              <Text key={warning.code} style={s.warningText}>• {warning.code.replace(/_/g, " ").toLowerCase()}</Text>
            ))}
            <Text style={s.warningText}>Only continue if you know the recipient and nobody is pressuring you to send money.</Text>
          </View>
        )}

        <Pressable style={[s.button, (!paymentMethodId || remaining === 0) && s.buttonDisabled]} onPress={confirm} disabled={busy || !paymentMethodId || remaining === 0}>
          {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.buttonText}>{remaining === 0 ? "Quote expired" : warnings.length ? "I understand — send money" : "Securely confirm & send"}</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, paddingTop: 52 },
  back: { color: colors.text, fontSize: 20 },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  content: { padding: spacing.lg, paddingBottom: 60 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  rateRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  bigAmount: { color: colors.text, fontWeight: "900", fontSize: 18 },
  arrow: { color: colors.textFaint },
  rateDetail: { color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
  expiry: { color: colors.accent, fontSize: 12, fontWeight: "700", marginTop: spacing.sm },
  sectionTitle: { color: colors.text, fontWeight: "800", marginBottom: spacing.sm },
  muted: { color: colors.textFaint, fontSize: 13 },
  linkButton: { marginTop: spacing.sm },
  linkButtonText: { color: colors.accent, fontWeight: "700", fontSize: 12 },
  pmRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pmRowSelected: { borderColor: colors.accent },
  pmText: { color: colors.text, fontWeight: "700" },
  pmCheck: { color: colors.accent, fontWeight: "900" },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.md },
  warningCard: { backgroundColor: "#3A2B12", borderColor: "#D69E2E", borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  warningTitle: { color: "#F6C453", fontWeight: "900", marginBottom: spacing.sm },
  warningText: { color: colors.text, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  button: { backgroundColor: colors.accent, borderRadius: radius.lg, height: 54, alignItems: "center", justifyContent: "center" },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: colors.onAccent, fontWeight: "900", fontSize: 15 },
  resultBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  resultIcon: { fontSize: 40 },
  resultTitle: { color: colors.text, fontWeight: "900", fontSize: 20, marginTop: spacing.md },
  resultSub: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: spacing.sm }
});

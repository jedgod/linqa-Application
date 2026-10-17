import { currencyDigits, displayMoney, parseMoney } from "../../services/send-money-validation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, countryName, currencyFlag, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService, type LinqaSendQuote } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();
/** Wait for the person to stop typing before asking the server for a live rate. */
const QUOTE_DEBOUNCE_MS = 650;
const secondsLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));

export default function LinqaSendAmount() {
  const router = useRouter();
  const p = useLocalSearchParams<{ recipientId: string; recipientName: string; recipientCountry?: string; recipientType?: string; recipientCurrency: string; initialAmount?: string; purposeCode?: string }>();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);

  const [amount, setAmount] = useState(p.initialAmount ?? "");
  const [quote, setQuote] = useState<LinqaSendQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const requestId = useRef(0);
  // Standard delivery is free; instant adds a fee (1.85%, minimum 0.30) that the server prices into the quote.
  const [delivery, setDelivery] = useState<"standard" | "instant">("standard");

  const [sourceCurrency, setSourceCurrency] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    Promise.all([client.getSettings(), client.getLimits()]).then(([settings, limits]) => {
      const currency = settings.default_currency ?? limits.currency;
      if (!currency) throw new Error("Set your sending currency in LinqaSend settings first.");
      currencyDigits(currency);
      if (current) setSourceCurrency(currency);
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : "Sending currency unavailable."); });
    return () => { current = false; };
  }, [client]);
  const minor = sourceCurrency ? parseMoney(amount.trim(), sourceCurrency) : null;
  const invalid = amount.trim().length > 0 && minor === null;

  const fetchQuote = useCallback(async (sendMinor: string) => {
    if (!sourceCurrency) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const next = await client.createQuote({ recipientId: p.recipientId, sourceCurrency, destinationCurrency: p.recipientCurrency, sendAmountMinor: sendMinor, deliveryOption: delivery });
      if (id !== requestId.current) return; // a newer request superseded this one
      setQuote(next);
      setRemaining(secondsLeft(next.expiresAt));
    } catch (cause) {
      if (id !== requestId.current) return;
      setQuote(null);
      setError(cause instanceof Error ? cause.message : "A live quote is unavailable.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [client, p.recipientId, p.recipientCurrency, sourceCurrency, delivery]);

  // A new amount: drop the old quote immediately (its receive amount no longer applies) and fetch after a pause.
  useEffect(() => {
    requestId.current++;
    setQuote(null);
    if (sourceCurrency) setError(null);
    if (!minor) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => void fetchQuote(minor), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [minor, fetchQuote]);

  // Count down the guarantee and refresh the rate when it lapses.
  useEffect(() => {
    if (!quote) return;
    const timer = setInterval(() => {
      const left = secondsLeft(quote.expiresAt);
      setRemaining(left);
      if (left === 0 && minor && !loading) void fetchQuote(minor);
    }, 1000);
    return () => clearInterval(timer);
  }, [quote, minor, fetchQuote, loading]);

  function explain() {
    Alert.alert(
      "About this rate",
      quote
        ? `The market rate is 1 ${quote.sendCurrency} = ${Number(quote.marketReferenceRate).toFixed(4)} ${quote.receiveCurrency}. Your rate includes a disclosed margin of ${(quote.marginBps / 100).toFixed(2)}%, so there is no separate fee. It is guaranteed until the countdown ends.`
        : "Enter an amount to see the live rate. It is guaranteed for a short time once shown."
    );
  }

  function next() {
    if (!quote || remaining === 0) return;
    router.push({
      pathname: "/linqasend/select-payment",
      params: { quote: JSON.stringify(quote), recipientName: p.recipientName, ...(p.recipientCountry ? { recipientCountry: p.recipientCountry } : {}), ...(p.recipientType ? { recipientType: p.recipientType } : {}), ...(p.purposeCode ? { purposeCode: p.purposeCode } : {}) }
    });
  }

  const ready = Boolean(quote) && remaining > 0 && !loading;
  const missingRecipient = !p.recipientId || !p.recipientCurrency;
  const receive = quote ? displayMoney(quote.receiveAmountMinor, quote.receiveCurrency) : "";
  const fee = (value: string | undefined, currency: string) => `${displayMoney(value ?? "0", currency)} ${currency}`;

  // Opened without a recipient (a stale link or a restored session): send the person back to choose one
  // instead of rendering with undefined values.
  if (missingRecipient) {
    return (
      <SafeAreaView style={s.screen}>
        <LinqaSendStatusBar />
        <View style={s.content}>
          <Text style={s.title}>Choose a recipient first</Text>
          <Pressable accessibilityRole="button" style={[s.continue, { marginTop: 20 }]} onPress={() => router.replace("/linqasend/recipients")}>
            <Text style={s.continueText}>Select recipient</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Enter Amount</Text>
        <View style={s.headerButton} />
      </View>

      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.to}>To {p.recipientName}{p.recipientCountry ? ` • ${countryName(p.recipientCountry)}` : ""}</Text>

        <Text style={s.label}>You send</Text>
        <View style={[s.field, invalid && s.fieldInvalid]}>
          <View style={s.currency}>
            <Text style={s.flag}>{currencyFlag(sourceCurrency ?? "")}</Text>
            <Text style={s.code}>{sourceCurrency ?? "?"}</Text>
          </View>
          <TextInput
            accessibilityLabel="Amount to send"
            value={amount}
            onChangeText={(text) => setAmount(text.replace(",", "."))}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={send.faint}
            style={s.amountInput}
            autoFocus
          />
        </View>
        {invalid ? <Text style={s.hint}>Enter a valid amount for the selected sending currency.</Text> : null}

        <Text style={[s.label, { marginTop: 18 }]}>They receive</Text>
        <View style={s.field}>
          <View style={s.currency}>
            <Text style={s.flag}>{currencyFlag(p.recipientCurrency)}</Text>
            <Text style={s.code}>{p.recipientCurrency}</Text>
          </View>
          <View style={s.receiveBox}>
            {loading ? <ActivityIndicator color={send.primary} /> : <Text style={[s.amountText, !receive && { color: send.faint }]}>{receive || "0.00"}</Text>}
          </View>
        </View>

        <View style={s.rateCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.rateTitle}>Exchange rate{quote && remaining > 0 ? ` (Guaranteed ${remaining}s)` : ""}</Text>
            <Text style={s.rateValue}>
              {quote ? `1 ${quote.sendCurrency} = ${Number(quote.customerRate).toFixed(4)} ${quote.receiveCurrency}` : loading ? "Getting live rate…" : error ? "Rate unavailable" : "Enter an amount"}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="About this rate" style={s.info} onPress={explain}>
            <Ionicons name="information-circle-outline" size={26} color={send.primary} />
          </Pressable>
        </View>

        <Text style={[s.feeLabel, { marginTop: 18 }]}>Instant delivery fee</Text>
        <View style={s.deliveryRow}>
          {([["standard", "Skip the fee", "Free"], ["instant", "Pay the fee", "1.85% (min 0.30)"]] as const).map(([value, title, note]) => (
            <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: delivery === value }} onPress={() => setDelivery(value)} style={[s.deliveryChip, delivery === value && s.deliveryChipOn]}>
              <Text style={[s.deliveryTitle, delivery === value && s.deliveryTitleOn]}>{title}</Text>
              <Text style={s.deliveryNote}>{note}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.deliveryHelp}>
          {delivery === "instant"
            ? "The money goes straight to the receiver's wallet. Because you cover the fee, they can deposit it to their bank or card instantly at no cost."
            : "The money goes straight to the receiver's wallet. They choose how to deposit it: wait 3 business days for free, or pay the fee themselves to get it instantly."}
        </Text>

        <View style={s.feeRow}><Text style={s.feeLabel}>Transfer fee</Text><Text style={s.feeValue}>{quote ? fee(quote.senderFeeMinor, quote.sendCurrency) : "—"}</Text></View>
        <View style={s.feeRow}><Text style={s.feeLabel}>Recipient fee</Text><Text style={s.feeValue}>{quote ? fee(quote.recipientFeeMinor, quote.receiveCurrency) : "—"}</Text></View>
        {quote && quote.deliveryOption === "instant" ? <View style={s.feeRow}><Text style={s.feeLabel}>Total to be charged</Text><Text style={s.feeValue}>{fee(quote.totalChargedMinor, quote.sendCurrency)}</Text></View> : null}

        <View style={s.banner}>
          <View style={s.bannerIcon}><Ionicons name="shield-checkmark-outline" size={26} color={send.success} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.bannerTitle}>{quote?.deliveryOption === "instant" ? "Instant delivery fee shown above. See the rate first." : "No separate fees. See the rate first."}</Text>
            <Text style={s.bannerText}>The exchange rate includes our disclosed margin, and you see exactly what your recipient gets.</Text>
          </View>
        </View>

        {error ? <Text style={s.error}>{error.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Text> : null}
      </ScrollView>

      <View style={s.footer}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready }} disabled={!ready} style={[s.continue, !ready && s.continueDisabled]} onPress={next}>
          <Text style={s.continueText}>Continue</Text>
        </Pressable>
        <View style={s.footNote}>
          <Ionicons name="time-outline" size={16} color={send.muted} />
          <Text style={s.footNoteText}>Rate updates in real-time</Text>
        </View>
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
  to: { color: send.primary, fontFamily: fonts.semibold, fontSize: 14, marginBottom: 14 },
  label: { color: send.text, fontFamily: fonts.bold, fontSize: 15, marginBottom: 10 },
  field: { flexDirection: "row", alignItems: "stretch", height: 70, borderRadius: 16, borderWidth: 1.5, borderColor: send.border, backgroundColor: send.bg, overflow: "hidden" },
  fieldInvalid: { borderColor: send.danger },
  currency: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderRightWidth: 1, borderRightColor: send.border, minWidth: 124 },
  flag: { fontSize: 18 },
  code: { color: send.text, fontFamily: fonts.bold, fontSize: 16 },
  amountInput: { flex: 1, textAlign: "right", paddingHorizontal: 18, color: send.text, fontFamily: fonts.extrabold, fontSize: 18 },
  receiveBox: { flex: 1, alignItems: "flex-end", justifyContent: "center", paddingHorizontal: 18 },
  amountText: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18 },
  hint: { color: send.danger, fontFamily: fonts.medium, fontSize: 13, marginTop: 6 },
  rateCard: { flexDirection: "row", alignItems: "center", backgroundColor: send.primarySoft, borderWidth: 1, borderColor: "#D9DDFB", borderRadius: 16, padding: 16, marginTop: 20 },
  rateTitle: { color: send.muted, fontFamily: fonts.medium, fontSize: 13 },
  rateValue: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18, marginTop: 6 },
  info: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  feeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  deliveryRow: { flexDirection: "row", gap: 12, marginTop: 10 },
  deliveryChip: { flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: send.border, paddingVertical: 12, paddingHorizontal: 14 },
  deliveryChipOn: { borderColor: send.primary, backgroundColor: "#EEF0FF" },
  deliveryTitle: { color: send.text, fontFamily: fonts.bold, fontSize: 15 },
  deliveryTitleOn: { color: send.primary },
  deliveryHelp: { color: send.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 10 },
  deliveryNote: { color: send.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  feeLabel: { color: send.text, fontFamily: fonts.medium, fontSize: 15 },
  feeValue: { color: send.text, fontFamily: fonts.bold, fontSize: 15 },
  banner: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#ECFDF3", borderWidth: 1, borderColor: "#BFEBD0", borderRadius: 16, padding: 16, marginTop: 22 },
  bannerIcon: { width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: send.success, alignItems: "center", justifyContent: "center" },
  bannerTitle: { color: "#067647", fontFamily: fonts.extrabold, fontSize: 16 },
  bannerText: { color: "#067647", fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 3 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 16 },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, backgroundColor: send.bg },
  continue: { height: 56, borderRadius: 16, backgroundColor: send.primary, alignItems: "center", justifyContent: "center" },
  continueDisabled: { opacity: 0.45 },
  continueText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 },
  footNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14 },
  footNoteText: { color: send.muted, fontFamily: fonts.medium, fontSize: 14 }
});

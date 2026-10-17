import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { BRAND_LABEL, cvvLength, detectBrand, digitsOnly, formatCardNumber, formatExpiry, formatZip, parseExpiry, validateCardForm, type CardFormErrors } from "../../services/card-input";
import { scanCardForForm } from "../../services/card-scan";
import { describeScanOutcome, expiryDigits } from "../../services/card-scan-parse";
import { getCardTokenizer } from "../../services/card-tokenizer";
import { LinqaSendService } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();
const CARD_TYPE_LABEL = { CREDIT_CARD: "Credit card", DEBIT_CARD: "Debit card" } as const;

function BrandMark({ number }: { number: string }) {
  const brand = detectBrand(number);
  if (brand === "UNKNOWN") return <Ionicons name="card-outline" size={26} color={send.faint} />;
  const color = brand === "VISA" ? "#1A1F71" : brand === "MASTERCARD" ? "#EB001B" : brand === "AMEX" ? "#2E77BC" : "#E55C20";
  return <Text style={[s.brandMark, { color }]}>{brand === "MASTERCARD" ? "MC" : brand === "DISCOVER" ? "DISC" : brand}</Text>;
}

/**
 * Add New Card. Card details live only in this screen's state and are passed to the payment
 * provider's own tokenizer. They are never sent to LinqaSend's servers, never logged and never
 * stored. Until a provider SDK is wired in (card-tokenizer.ts) the screen validates the form
 * but will not submit.
 */
export default function LinqaSendAddCard() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const tokenizer = useMemo(() => getCardTokenizer(), []);

  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [cardType, setCardType] = useState<"CREDIT_CARD" | "DEBIT_CARD">("CREDIT_CARD");
  const [name, setName] = useState("");
  const [zip, setZip] = useState("");
  const [typeOpen, setTypeOpen] = useState(false);
  const [errors, setErrors] = useState<CardFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Card details must not outlive the screen.
  useEffect(() => () => { setNumber(""); setCvv(""); setExpiry(""); }, []);

  const brand = detectBrand(number);

  /** Auto-scan: fills the number, expiry and name from the camera. The security code is never scanned: type it yourself. */
  async function autoScan() {
    if (scanning || busy) return;
    setScanning(true);
    setMessage(null);
    try {
      const outcome = await scanCardForForm();
      if (outcome.status === "filled") {
        setNumber(formatCardNumber(outcome.card.number));
        const digits = expiryDigits(outcome.card);
        if (digits) setExpiry(formatExpiry(digits));
        if (outcome.card.holderName) setName(outcome.card.holderName);
        setCvv("");
        setErrors({});
      }
      setMessage(describeScanOutcome(outcome));
    } finally {
      setScanning(false);
    }
  }

  async function submit() {
    setMessage(null);
    const found = validateCardForm({ number, expiry, cvv, name, zip });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!tokenizer) {
      // No provider tokenizer: do NOT send card data anywhere.
      setMessage("Adding cards isn't available yet. Card entry stays off until our payment partner is connected, so your details are never sent anywhere else.");
      return;
    }
    setBusy(true);
    try {
      const expiryParts = parseExpiry(expiry)!;
      const session = await client.setupPaymentMethod({ type: cardType, billingCountry: "US" });
      await tokenizer.submit({ setupToken: session.setupToken, clientSecret: session.clientSecret, ...(session.cardEndpoint ? { cardEndpoint: session.cardEndpoint } : {}) }, {
        number: digitsOnly(number), expMonth: expiryParts.month, expYear: expiryParts.year, cvv: digitsOnly(cvv), holderName: name.trim(), billingPostalCode: zip.trim()
      });
      await client.confirmPaymentMethod(session.setupToken);
      setNumber(""); setCvv(""); setExpiry("");
      router.replace("/linqasend/payment-methods");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to add this card.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Add New Card</Text>
        <View style={s.headerButton} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          {!tokenizer ? (
            <View style={s.notice} accessibilityRole="alert">
              <Ionicons name="information-circle-outline" size={22} color={send.warning} />
              <Text style={s.noticeText}>Card payments aren't turned on yet. You can preview this form, but it can't save a card until a payment partner is connected.</Text>
            </View>
          ) : null}

          <Text style={s.label}>Card Type</Text>
          <Pressable
            accessibilityRole="combobox" accessibilityLabel="Card type" accessibilityValue={{ text: CARD_TYPE_LABEL[cardType] }} accessibilityState={{ expanded: typeOpen }}
            style={[s.field, typeOpen && { borderColor: send.primary }]} onPress={() => setTypeOpen((open) => !open)}
          >
            <Text style={s.dropdownValue}>{CARD_TYPE_LABEL[cardType]}</Text>
            <Ionicons name={typeOpen ? "chevron-up" : "chevron-down"} size={20} color={send.muted} />
          </Pressable>
          {typeOpen ? (
            <View style={s.dropdownList} accessibilityRole="list">
              {(["CREDIT_CARD", "DEBIT_CARD"] as const).map((kind) => (
                <Pressable key={kind} accessibilityRole="menuitem" accessibilityState={{ selected: cardType === kind }} onPress={() => { setCardType(kind); setTypeOpen(false); }} style={[s.dropdownItem, cardType === kind && s.dropdownItemOn]}>
                  <Text style={[s.dropdownItemText, cardType === kind && s.dropdownItemTextOn]}>{CARD_TYPE_LABEL[kind]}</Text>
                  {cardType === kind ? <Ionicons name="checkmark" size={20} color={send.primary} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityLabel="Scan card with the camera" accessibilityState={{ busy: scanning, disabled: scanning || busy }} disabled={scanning || busy} style={[s.scan, (scanning || busy) && { opacity: 0.6 }]} onPress={autoScan}>
            {scanning ? <ActivityIndicator color={send.primary} /> : <Ionicons name="scan-outline" size={22} color={send.primary} />}
            <Text style={s.scanText}>{scanning ? "Opening camera…" : "Scan card with camera"}</Text>
          </Pressable>

          <Text style={s.label}>Card Number</Text>
          <View style={[s.field, errors.number && s.fieldError]}>
            <TextInput
              accessibilityLabel="Card number" value={number} onChangeText={(t) => setNumber(formatCardNumber(t))}
              placeholder="1234 5678 9012 3456" placeholderTextColor={send.faint} keyboardType="number-pad" maxLength={23}
              autoComplete="off" importantForAutofill="no" textContentType="none" autoCorrect={false} contextMenuHidden style={s.inputBare}
            />
            <BrandMark number={number} />
          </View>
          {errors.number ? <Text style={s.fieldMessage}>{errors.number}</Text> : brand !== "UNKNOWN" ? <Text style={s.helper}>{BRAND_LABEL[brand]}</Text> : null}

          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Expiry Date</Text>
              <View style={[s.field, errors.expiry && s.fieldError]}>
                <TextInput accessibilityLabel="Expiry date" value={expiry} onChangeText={(t) => setExpiry(formatExpiry(t))} placeholder="MM / YY" placeholderTextColor={send.faint} keyboardType="number-pad" maxLength={7} autoComplete="off" importantForAutofill="no" contextMenuHidden style={s.inputBare} />
              </View>
              {errors.expiry ? <Text style={s.fieldMessage}>{errors.expiry}</Text> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>CVV</Text>
              <View style={[s.field, errors.cvv && s.fieldError]}>
                <TextInput accessibilityLabel="Security code" value={cvv} onChangeText={(t) => setCvv(digitsOnly(t).slice(0, cvvLength(brand)))} placeholder={brand === "AMEX" ? "1234" : "123"} placeholderTextColor={send.faint} keyboardType="number-pad" secureTextEntry maxLength={4} autoComplete="off" importantForAutofill="no" contextMenuHidden style={s.inputBare} />
                <Pressable accessibilityRole="button" accessibilityLabel="Where is the security code?" hitSlop={10} onPress={() => Alert.alert("Security code", brand === "AMEX" ? "The 4 digits printed on the front of your card, above the number." : "The 3 digits on the back of your card, next to the signature strip.")}>
                  <Ionicons name="information-circle-outline" size={24} color={send.muted} />
                </Pressable>
              </View>
              {errors.cvv ? <Text style={s.fieldMessage}>{errors.cvv}</Text> : null}
            </View>
          </View>

          <Text style={s.label}>Cardholder Name</Text>
          <View style={[s.field, errors.name && s.fieldError]}>
            <TextInput accessibilityLabel="Cardholder name" value={name} onChangeText={setName} placeholder="Name on card" placeholderTextColor={send.faint} autoCapitalize="words" autoComplete="off" importantForAutofill="no" style={s.inputBare} />
          </View>
          {errors.name ? <Text style={s.fieldMessage}>{errors.name}</Text> : null}

          <Text style={s.label}>ZIP Code</Text>
          <View style={[s.field, errors.zip && s.fieldError]}>
            <TextInput accessibilityLabel="Billing ZIP code" value={zip} onChangeText={(t) => setZip(formatZip(t))} placeholder="20740" placeholderTextColor={send.faint} keyboardType="number-pad" maxLength={10} autoComplete="postal-code" textContentType="postalCode" importantForAutofill="no" style={s.inputBare} />
          </View>
          {errors.zip ? <Text style={s.fieldMessage}>{errors.zip}</Text> : <Text style={s.helper}>The ZIP code where your card statement is sent.</Text>}

          <View style={s.saveRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.saveText}>Save card for future use</Text>
              <Text style={s.helper}>Cards are saved so you can reuse them securely.</Text>
            </View>
            <Switch accessibilityLabel="Save card for future use" value disabled trackColor={{ true: send.primary, false: send.border }} thumbColor="#FFFFFF" />
          </View>

          {message ? <Text style={s.message} accessibilityLiveRegion="polite">{message}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={s.footer}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={[s.add, busy && { opacity: 0.6 }]} onPress={submit}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.addText}>Add Card</Text>}
        </Pressable>
        <View style={s.footNote}>
          <Ionicons name="lock-closed-outline" size={16} color={send.muted} />
          <Text style={s.footNoteText}>Card details go straight to our payment partner, never to us.</Text>
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
  form: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24 },
  notice: { flexDirection: "row", gap: 10, backgroundColor: "#FFFAEB", borderWidth: 1, borderColor: "#F5C451", borderRadius: 14, padding: 14, marginBottom: 4 },
  noticeText: { flex: 1, color: send.text, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  label: { color: send.text, fontFamily: fonts.semibold, fontSize: 14, marginTop: 18, marginBottom: 9 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: send.border, paddingHorizontal: 16, backgroundColor: send.bg },
  fieldError: { borderColor: send.danger },
  inputBare: { flex: 1, color: send.text, fontFamily: fonts.semibold, fontSize: 16, paddingVertical: 0 },
  brandMark: { fontFamily: fonts.extrabold, fontSize: 15, fontStyle: "italic" },
  row: { flexDirection: "row", gap: 14 },
  scan: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: send.primary, marginTop: 16 },
  scanText: { color: send.primary, fontFamily: fonts.bold, fontSize: 15 },
  dropdownValue: { flex: 1, color: send.text, fontFamily: fonts.semibold, fontSize: 16 },
  dropdownList: { marginTop: 6, borderRadius: 14, borderWidth: 1.5, borderColor: send.border, backgroundColor: send.bg, overflow: "hidden" },
  dropdownItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, paddingHorizontal: 16 },
  dropdownItemOn: { backgroundColor: "#EEF0FF" },
  dropdownItemText: { color: send.text, fontFamily: fonts.medium, fontSize: 16 },
  dropdownItemTextOn: { color: send.primary, fontFamily: fonts.bold },
  fieldMessage: { color: send.danger, fontFamily: fonts.medium, fontSize: 13, marginTop: 6 },
  helper: { color: send.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 6 },
  saveRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 24 },
  saveText: { color: send.text, fontFamily: fonts.semibold, fontSize: 15 },
  message: { color: send.danger, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, marginTop: 18 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, backgroundColor: send.bg },
  add: { height: 56, borderRadius: 16, backgroundColor: send.primary, alignItems: "center", justifyContent: "center" },
  addText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 },
  footNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12 },
  footNoteText: { color: send.muted, fontFamily: fonts.medium, fontSize: 13 }
});

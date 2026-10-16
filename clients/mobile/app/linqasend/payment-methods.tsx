import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, LinqaSendTabBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { BRAND_LABEL, type CardBrand } from "../../services/card-input";
import { LinqaSendService, type LinqaSendPaymentMethod } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();

const isCard = (m: LinqaSendPaymentMethod) => m.type === "DEBIT_CARD" || m.type === "CREDIT_CARD";
const usable = (m: LinqaSendPaymentMethod) => m.verificationStatus === "VERIFIED";

function brandOf(method: LinqaSendPaymentMethod): CardBrand {
  const name = (method.brand ?? "").toLowerCase();
  if (name.includes("visa")) return "VISA";
  if (name.includes("master")) return "MASTERCARD";
  if (name.includes("amex") || name.includes("american")) return "AMEX";
  if (name.includes("discover")) return "DISCOVER";
  return "UNKNOWN";
}

function BrandBadge({ brand }: { brand: CardBrand }) {
  if (brand === "MASTERCARD") {
    return <View style={s.mc}><View style={[s.mcCircle, { backgroundColor: "#EB001B" }]} /><View style={[s.mcCircle, { backgroundColor: "#F79E1B", marginLeft: -10 }]} /></View>;
  }
  if (brand === "VISA") return <View style={[s.badge, { backgroundColor: "#1A1F71" }]}><Text style={s.badgeText}>VISA</Text></View>;
  if (brand === "AMEX") return <View style={[s.badge, { backgroundColor: "#2E77BC" }]}><Text style={s.badgeText}>AMEX</Text></View>;
  if (brand === "DISCOVER") return <View style={[s.badge, { backgroundColor: "#E55C20" }]}><Text style={s.badgeText}>DISC</Text></View>;
  return <View style={[s.badge, { backgroundColor: send.primarySoft }]}><Ionicons name="card-outline" size={22} color={send.primary} /></View>;
}

function detail(method: LinqaSendPaymentMethod): string {
  if (!usable(method)) return "Verification pending";
  if (method.expMonth && method.expYear) return `Expires ${String(method.expMonth).padStart(2, "0")}/${String(method.expYear).slice(-2)}`;
  return method.type === "CREDIT_CARD" ? "Credit card" : method.type === "DEBIT_CARD" ? "Debit card" : "Ready to use";
}

/** Cards on File. Brand and expiry appear when the payment provider has reported them. */
export default function LinqaSendPaymentMethods() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [methods, setMethods] = useState<LinqaSendPaymentMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [otherType, setOtherType] = useState<"BANK_ACCOUNT" | "MOBILE_WALLET">("BANK_ACCOUNT");
  const [reference, setReference] = useState("");
  const [last4, setLast4] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setMethods((await client.listPaymentMethods()).items);
    } catch (cause) {
      setMethods([]);
      setError(cause instanceof Error ? cause.message : "Unable to load your payment methods");
    }
  }, [client]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function makeDefault(method: LinqaSendPaymentMethod) {
    if (method.isDefault || !usable(method) || busy) return;
    setBusy(method.id);
    setError(null);
    const previous = methods;
    // Show the change right away and put it back if the server refuses.
    setMethods((current) => current?.map((m) => ({ ...m, isDefault: m.id === method.id })) ?? current);
    try {
      await client.updateSettings({ defaultPaymentMethodId: method.id });
    } catch (cause) {
      setMethods(previous);
      setError(cause instanceof Error ? cause.message : "Unable to change your default");
    } finally {
      setBusy(null);
    }
  }

  function confirmRemove(method: LinqaSendPaymentMethod) {
    Alert.alert("Remove this payment method?", `${method.type.replace(/_/g, " ").toLowerCase()} •••• ${method.last4 ?? ""}`, [
      { text: "Keep", style: "cancel" },
      {
        text: "Remove", style: "destructive",
        onPress: async () => {
          setBusy(method.id);
          try { await client.deletePaymentMethod(method.id); await load(); }
          catch (cause) { setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to remove"); }
          finally { setBusy(null); }
        }
      }
    ]);
  }

  async function addOther() {
    if (reference.trim().length < 4) { setError("Enter the reference your bank or wallet provider gave you."); return; }
    setBusy("other");
    setError(null);
    try {
      await client.addPaymentMethod({ type: otherType, reference: reference.trim(), ...(last4.length === 4 ? { last4 } : {}) });
      setReference(""); setLast4(""); setShowOther(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Unable to add this funding source");
    } finally {
      setBusy(null);
    }
  }

  const cards = (methods ?? []).filter(isCard);
  const others = (methods ?? []).filter((m) => !isCard(m));

  const renderCard = (method: LinqaSendPaymentMethod) => {
    const brand = brandOf(method);
    return (
      <Pressable
        key={method.id}
        accessibilityRole="button"
        accessibilityLabel={`${BRAND_LABEL[brand]} ending ${method.last4 ?? ""}${method.isDefault ? ", default" : ""}. ${usable(method) ? "Tap to make default. Hold to remove." : "Verification pending."}`}
        disabled={busy === method.id}
        style={[s.card, method.isDefault && s.cardDefault, !usable(method) && { opacity: 0.6 }]}
        onPress={() => makeDefault(method)}
        onLongPress={() => confirmRemove(method)}
      >
        <BrandBadge brand={brand} />
        <View style={s.cardText}>
          <Text style={s.cardTitle}>{BRAND_LABEL[brand] === "Card" ? (method.type === "CREDIT_CARD" ? "Credit card" : "Debit card") : BRAND_LABEL[brand]}  ••••  {method.last4 ?? "----"}</Text>
          <Text style={s.cardSub}>{detail(method)}</Text>
        </View>
        {method.isDefault ? <View style={s.defaultPill}><Text style={s.defaultText}>Default</Text></View> : null}
        {busy === method.id ? <ActivityIndicator color={send.primary} /> : method.isDefault ? <View style={s.check}><Ionicons name="checkmark" size={16} color="#FFFFFF" /></View> : <View style={s.radio} />}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Payment Methods</Text>
        <View style={s.headerButton} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.section}>Debit/Credit Cards</Text>
        {methods === null ? <ActivityIndicator color={send.primary} style={{ marginTop: 30 }} /> : null}
        {cards.map(renderCard)}
        {methods !== null && cards.length === 0 && !error ? <Text style={s.empty}>No cards on file yet.</Text> : null}
        {cards.length > 0 ? <Text style={s.hint}>Tap a card to make it your default. Press and hold to remove it.</Text> : null}

        <Pressable accessibilityRole="button" style={s.add} onPress={() => router.push("/linqasend/add-card")}>
          <Ionicons name="add" size={28} color={send.primary} />
          <Text style={s.addText}>Add New Card</Text>
        </Pressable>

        {others.length > 0 ? <><Text style={[s.section, { marginTop: 22 }]}>Bank accounts & wallets</Text>{others.map(renderCard)}</> : null}

        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showOther }} style={s.otherToggle} onPress={() => setShowOther((v) => !v)}>
          <Text style={s.otherToggleText}>Add a bank account or wallet</Text>
          <Ionicons name={showOther ? "chevron-up" : "chevron-down"} size={18} color={send.primary} />
        </Pressable>
        {showOther ? (
          <View style={s.otherForm}>
            <View style={s.segment}>
              {([["BANK_ACCOUNT", "Bank account"], ["MOBILE_WALLET", "Mobile wallet"]] as const).map(([key, label]) => (
                <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: otherType === key }} style={[s.segmentItem, otherType === key && s.segmentOn]} onPress={() => setOtherType(key)}>
                  <Text style={[s.segmentText, otherType === key && { color: "#FFFFFF" }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput accessibilityLabel="Provider reference" value={reference} onChangeText={setReference} placeholder="Reference from your bank or wallet provider" placeholderTextColor={send.faint} autoCapitalize="none" autoCorrect={false} style={s.input} />
            <TextInput accessibilityLabel="Last 4 digits" value={last4} onChangeText={(t) => setLast4(t.replace(/\D/g, "").slice(0, 4))} placeholder="Last 4 digits (optional)" placeholderTextColor={send.faint} keyboardType="number-pad" style={s.input} />
            <Pressable accessibilityRole="button" disabled={busy === "other"} style={s.save} onPress={addOther}>
              {busy === "other" ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.saveText}>Add</Text>}
            </Pressable>
          </View>
        ) : null}

        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Text> : null}
      </ScrollView>

      <View style={s.secure}>
        <Ionicons name="lock-closed-outline" size={20} color={send.muted} />
        <Text style={s.secureText}>Your cards are secure and encrypted.</Text>
      </View>
      <LinqaSendTabBar active="cards" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 16 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  section: { color: send.text, fontFamily: fonts.bold, fontSize: 16, marginBottom: 14 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1.5, borderColor: send.border, borderRadius: 16, padding: 16, marginBottom: 14, backgroundColor: send.bg },
  cardDefault: { borderColor: send.primary, backgroundColor: send.primarySoft },
  cardText: { flex: 1 },
  cardTitle: { color: send.text, fontFamily: fonts.bold, fontSize: 16 },
  cardSub: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 4 },
  defaultPill: { backgroundColor: "#DDE0FB", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  defaultText: { color: send.primary, fontFamily: fonts.bold, fontSize: 12 },
  check: { width: 30, height: 30, borderRadius: 15, backgroundColor: send.primary, alignItems: "center", justifyContent: "center" },
  radio: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: send.border },
  badge: { width: 54, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#FFFFFF", fontFamily: fonts.extrabold, fontSize: 13, fontStyle: "italic" },
  mc: { width: 54, height: 40, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  mcCircle: { width: 26, height: 26, borderRadius: 13, opacity: 0.95 },
  hint: { color: send.faint, fontFamily: fonts.regular, fontSize: 13, marginBottom: 6 },
  empty: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, marginBottom: 6 },
  add: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 18 },
  addText: { color: send.primary, fontFamily: fonts.bold, fontSize: 16 },
  otherToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, marginTop: 8, borderTopWidth: 1, borderTopColor: send.border },
  otherToggleText: { color: send.primary, fontFamily: fonts.bold, fontSize: 15 },
  otherForm: { gap: 12, paddingBottom: 8 },
  segment: { flexDirection: "row", gap: 8 },
  segmentItem: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: send.border, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: send.primary, borderColor: send.primary },
  segmentText: { color: send.text, fontFamily: fonts.semibold, fontSize: 14 },
  input: { height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: send.border, paddingHorizontal: 14, color: send.text, fontFamily: fonts.medium, fontSize: 15 },
  save: { height: 50, borderRadius: 14, backgroundColor: send.primary, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 12 },
  secure: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 14, backgroundColor: send.surface },
  secureText: { color: send.muted, fontFamily: fonts.medium, fontSize: 14 }
});

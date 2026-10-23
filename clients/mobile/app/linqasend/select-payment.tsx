import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();

type Method = { id: string; type: string; last4: string | null; verificationStatus: string };

const KIND: Record<string, { title: string; icon: keyof typeof Ionicons.glyphMap }> = {
  DEBIT_CARD: { title: "Debit card", icon: "card-outline" },
  CREDIT_CARD: { title: "Credit card", icon: "card-outline" },
  BANK_ACCOUNT: { title: "Bank account", icon: "business-outline" },
  MOBILE_WALLET: { title: "Mobile wallet", icon: "phone-portrait-outline" }
};
const kindOf = (type: string) => KIND[type] ?? { title: type.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), icon: "wallet-outline" as const };
const isCard = (m: Method) => m.type === "DEBIT_CARD" || m.type === "CREDIT_CARD";
const usable = (m: Method) => m.verificationStatus === "VERIFIED";

export default function LinqaSendSelectPayment() {
  const router = useRouter();
  const params = useLocalSearchParams<{ quote: string; recipientName: string; recipientCountry?: string; recipientType?: string; purposeCode?: string }>();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reload on focus so a method added on the Funding Sources screen appears when the person comes back.
  useFocusEffect(useCallback(() => {
    let current = true;
    setError(null);
    client.listPaymentMethods()
      .then((result) => {
        if (!current) return;
        setMethods(result.items);
        setSelected((previous) => (previous && result.items.some((m) => m.id === previous && usable(m)) ? previous : result.items.find(usable)?.id ?? null));
      })
      .catch((cause) => { if (current) { setMethods([]); setError(cause instanceof Error ? cause.message : "Unable to load your payment methods"); } });
    return () => { current = false; };
  }, [client]));

  const cards = (methods ?? []).filter(isCard);
  const others = (methods ?? []).filter((m) => !isCard(m));

  function renderMethod(method: Method) {
    const kind = kindOf(method.type);
    const enabled = usable(method);
    const chosen = selected === method.id;
    return (
      <Pressable
        key={method.id}
        accessibilityRole="radio"
        accessibilityState={{ checked: chosen, disabled: !enabled }}
        accessibilityLabel={`${kind.title}${method.last4 ? ` ending ${method.last4}` : ""}${enabled ? "" : ", verification pending"}`}
        disabled={!enabled}
        style={[s.method, chosen && s.methodSelected, !enabled && s.methodDisabled]}
        onPress={() => setSelected(method.id)}
      >
        <View style={s.methodIcon}><Ionicons name={kind.icon} size={26} color={send.primary} /></View>
        <View style={s.methodText}>
          <Text style={s.methodTitle}>{kind.title}{method.last4 ? `  ••••  ${method.last4}` : ""}</Text>
          <Text style={s.methodSub}>{enabled ? "Ready to use" : "Verification pending"}</Text>
        </View>
        <View style={[s.radio, chosen && s.radioOn]}>{chosen ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}</View>
      </Pressable>
    );
  }

  function next() {
    if (!selected) return;
    router.push({ pathname: "/linqasend/review", params: { quote: params.quote, recipientName: params.recipientName, paymentMethodId: selected, ...(params.recipientCountry ? { recipientCountry: params.recipientCountry } : {}), ...(params.recipientType ? { recipientType: params.recipientType } : {}), ...(params.purposeCode ? { purposeCode: params.purposeCode } : {}) } });
  }

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Select Payment Method</Text>
        <View style={s.headerButton} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {methods === null ? <ActivityIndicator color={send.primary} style={{ marginTop: 40 }} /> : null}
        {error ? <Text style={s.error}>{error.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Text> : null}

        {cards.length > 0 ? <><Text style={s.section}>Cards on File</Text>{cards.map(renderMethod)}</> : null}
        {others.length > 0 ? <><Text style={[s.section, cards.length > 0 && { marginTop: 22 }]}>Bank accounts & wallets</Text>{others.map(renderMethod)}</> : null}
        {methods !== null && methods.length === 0 && !error ? (
          <Text style={s.empty}>You have no payment methods on file yet. Add one below to continue.</Text>
        ) : null}

        <Pressable accessibilityRole="button" style={s.add} onPress={()=>router.push("/wallet")}><Text style={s.addText}>Open wallet to send from your balance</Text></Pressable>
        <Text style={[s.section, { marginTop: 24 }]}>Other Ways to Pay</Text>
        {([["Add debit/credit card", "/linqasend/add-card"], ["Add bank account", "/linqasend/bank-link"]] as const).map(([label, route]) => (
          <Pressable key={label} accessibilityRole="button" style={s.add} onPress={() => router.push(route)}>
            <Ionicons name="add" size={26} color={send.primary} />
            <Text style={s.addText}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={s.footer}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !selected }} disabled={!selected} style={[s.continue, !selected && s.continueDisabled]} onPress={next}>
          <Text style={s.continueText}>Continue</Text>
        </Pressable>
        <View style={s.footNote}>
          <Ionicons name="lock-closed-outline" size={16} color={send.muted} />
          <Text style={s.footNoteText}>Your payment info is secure</Text>
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
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
  section: { color: send.text, fontFamily: fonts.bold, fontSize: 15, marginBottom: 12 },
  method: { flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1.5, borderColor: send.border, borderRadius: 16, padding: 16, marginBottom: 12, backgroundColor: send.bg },
  methodSelected: { borderColor: send.primary, backgroundColor: send.primarySoft },
  methodDisabled: { opacity: 0.55 },
  methodIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: send.primarySoft, alignItems: "center", justifyContent: "center" },
  methodText: { flex: 1 },
  methodTitle: { color: send.text, fontFamily: fonts.bold, fontSize: 16 },
  methodSub: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 3 },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: send.border, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: send.primary, borderColor: send.primary },
  add: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderColor: send.border, borderRadius: 16, paddingHorizontal: 16, height: 64, marginBottom: 12 },
  addText: { color: send.primary, fontFamily: fonts.bold, fontSize: 16 },
  empty: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14, marginBottom: 10 },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, backgroundColor: send.bg },
  continue: { height: 56, borderRadius: 16, backgroundColor: send.primary, alignItems: "center", justifyContent: "center" },
  continueDisabled: { opacity: 0.45 },
  continueText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 },
  footNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14 },
  footNoteText: { color: send.muted, fontFamily: fonts.medium, fontSize: 14 }
});

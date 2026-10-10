import { randomUUID } from "expo-crypto";
import { useCallback, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { METHODS, formatPrice, isSafeCheckoutUrl, safeReturn, type PaymentMethod, type PlanCard, type PlansResponse } from "../../services/countrylinqa-plans";
import { fonts } from "../../theme/tokens";

const newKey = () => `clq-${randomUUID()}`;

/** 6.3 Confirm Payment. The price shown is the server's; Pay starts the payment and goes to the result. */
export default function CountryLinqaConfirmPayment() {
  const router = useRouter();
  const client = useCountryClient();
  const { plan, method, from } = useLocalSearchParams<{ plan?: string; method?: string; from?: string }>();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  // One key per visit to this screen, so a double tap can never start two payments.
  const key = useRef(newKey());

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    client.plans().then((p) => { if (active) setData(p); }, (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load the plan"); });
    return () => { active = false; };
  }, [client, reload]));

  const card: PlanCard | undefined = data?.plans.find((p) => p.code === plan);
  const label = METHODS.find((m) => m.key === method)?.label;
  const origin = safeReturn(from);
  const valid = !!card && card.code !== "FREE" && METHODS.some((m) => m.key === method);

  async function pay() {
    if (!card || busy || !valid) return;
    setBusy(true); setError(null);
    try {
      const checkout = await client.createCheckout(card.code as "PREMIUM" | "ELITE", method as PaymentMethod, key.current);
      if (checkout.state === "CREATED" && isSafeCheckoutUrl(checkout.checkoutUrl)) {
        try { await Linking.openURL(checkout.checkoutUrl!); } catch { /* the result screen offers to open it again */ }
      }
      router.replace({ pathname: "/countrylinqa/plans-result", params: { id: checkout.id, plan: card.code, method: method ?? "", from: origin } });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "PLAN_NOT_AN_UPGRADE" ? "You already have this plan or a higher one." : "Unable to start the payment. You have not been charged.");
      key.current = newKey();
    } finally { setBusy(false); }
  }

  return (
    <WorldScreen>
      <WorldHeader title="Confirm Payment" back />
      <ScrollView contentContainerStyle={s.content}>
        {!data && !error ? <Spinner /> : null}
        {!valid && data ? <Empty icon="alert-circle-outline" title="Choose a plan first" text="Go back and pick a plan and a payment method." action={{ label: "Choose a plan", onPress: () => router.replace("/countrylinqa/plans-compare") }} /> : null}
        {card && valid ? (
          <>
            <View style={s.card}>
              <View style={s.check}><Ionicons name="checkmark" size={26} color="#FFFFFF" /></View>
              <View><Text style={s.name}>{card.name} Plan</Text><Text style={s.price}>{formatPrice(card.monthlyPriceMinor, card.currency, true)}</Text></View>
            </View>
            {card.features.map((f) => <View key={f} style={s.feature}><Ionicons name="checkmark" size={18} color="#12A150" /><Text style={s.featureText}>{f}</Text></View>)}
            <Text style={s.method}>Paying with {label}</Text>
            {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
          </>
        ) : null}
        {error && !valid ? <Empty icon="cloud-offline-outline" title="Can not load" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
      </ScrollView>
      {card && valid ? (
        <View style={s.footer}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={[s.primary, busy && { opacity: 0.6 }]} onPress={() => void pay()}>
            <Text style={s.primaryText}>{busy ? "Starting…" : `Pay ${formatPrice(card.monthlyPriceMinor, card.currency)}`}</Text>
          </Pressable>
          <Text style={s.fine}>You will be asked to finish on the payment page. Your plan starts only after the payment is confirmed.</Text>
        </View>
      ) : null}
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  card: { flexDirection: "row", alignItems: "center", gap: 16, borderRadius: 18, borderWidth: 1.5, borderColor: "#D9D2FF", padding: 18, marginBottom: 18 },
  check: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#12A150", alignItems: "center", justifyContent: "center" },
  name: { color: world.text, fontFamily: fonts.extrabold, fontSize: 20 },
  price: { color: world.purple, fontFamily: fonts.bold, fontSize: 18, marginTop: 2 },
  feature: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36 },
  featureText: { color: world.text, fontFamily: fonts.regular, fontSize: 15, flex: 1 },
  method: { color: world.muted, fontFamily: fonts.medium, fontSize: 14, marginTop: 16 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 14 },
  footer: { paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8 },
  primary: { height: 54, borderRadius: 14, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 17 },
  fine: { color: world.faint, fontFamily: fonts.regular, fontSize: 12, textAlign: "center", marginTop: 10 }
});

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { POLL_LIMIT, POLL_MS, failureMessage, resultOf, safeReturn, type Checkout } from "../../services/countrylinqa-plans";
import { fonts } from "../../theme/tokens";

/**
 * 6.4 Success, 6.5 Canceled, 6.6 Failed (and the wait in between). Success is shown only once billing
 * has confirmed the plan; until then it says the payment is still being confirmed.
 */
export default function CountryLinqaPlanResult() {
  const router = useRouter();
  const client = useCountryClient();
  const { id, plan, method, from } = useLocalSearchParams<{ id?: string; plan?: string; method?: string; from?: string }>();
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);
  const stopped = useRef(false);
  const origin = safeReturn(from);

  const poll = useCallback(async () => {
    if (!id) return;
    stopped.current = false; setWaited(false); setError(null);
    for (let i = 0; i < POLL_LIMIT && !stopped.current; i++) {
      try {
        const next = await client.checkout(id);
        if (stopped.current) return;
        setCheckout(next);
        if (resultOf(next) !== "PENDING") return;
      } catch { if (!stopped.current) setError("Unable to check your payment. Check your connection."); return; }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (!stopped.current) setWaited(true);
  }, [client, id]);
  useEffect(() => { void poll(); return () => { stopped.current = true; }; }, [poll]);

  const kind = checkout ? resultOf(checkout) : "PENDING";
  async function cancel() {
    if (!id) return;
    stopped.current = true;
    try { setCheckout(await client.cancelCheckout(id)); } catch { setError("Unable to cancel. Try again."); }
  }
  const retry = () => router.replace({ pathname: "/countrylinqa/plans-confirm", params: { plan: plan ?? "", method: method ?? "", from: origin } });

  const done = (label: string, onPress: () => void, secondary = false) => (
    <Pressable accessibilityRole="button" style={[s.btn, secondary && s.btnSecondary]} onPress={onPress}><Text style={[s.btnText, secondary && { color: world.purple }]}>{label}</Text></Pressable>
  );

  return (
    <WorldScreen>
      <View style={s.body} accessibilityLiveRegion="polite">
        {!id ? (
          <><Text style={s.title}>Nothing to show</Text><Text style={s.text}>There is no payment to check.</Text><View style={s.actions}>{done("Back", () => router.replace(origin as never))}</View></>
        ) : kind === "SUCCESS" ? (
          <>
            <View style={[s.icon, { backgroundColor: "#12A150" }]}><Ionicons name="checkmark" size={56} color="#FFFFFF" /></View>
            <Text style={s.title}>Subscription activated!</Text>
            <Text style={s.text}>Your {checkout?.planCode === "ELITE" ? "Elite" : "Premium"} plan is now active.</Text>
            <View style={s.actions}>{done("Continue", () => router.replace(origin as never))}</View>
          </>
        ) : kind === "CANCELED" ? (
          <>
            <View style={[s.icon, { backgroundColor: "#E5484D" }]}><Ionicons name="close" size={56} color="#FFFFFF" /></View>
            <Text style={s.title}>Payment Canceled</Text>
            <Text style={s.text}>No changes were made to your account.</Text>
            <View style={s.actions}>{done("Back", () => router.replace(origin as never))}</View>
          </>
        ) : kind === "FAILED" ? (
          <>
            <View style={[s.icon, { backgroundColor: "#FDECEC" }]}><Ionicons name="warning" size={56} color="#E5484D" /></View>
            <Text style={s.title}>Payment Failed</Text>
            <Text style={s.text}>{failureMessage(checkout?.failureCode ?? null)}</Text>
            <View style={s.actions}>
              {done("Try Again", retry)}
              {done("Change Method", () => router.replace({ pathname: "/countrylinqa/plans-method", params: { plan: plan ?? "", from: origin } }), true)}
            </View>
          </>
        ) : (
          <>
            {error ? <Ionicons name="cloud-offline-outline" size={56} color={world.faint} /> : <ActivityIndicator size="large" color={world.purple} />}
            <Text style={s.title}>{error ? "Can not check your payment" : "Waiting for your payment"}</Text>
            <Text style={s.text}>{error ?? (waited ? "It is taking longer than usual. Your plan will switch on as soon as the payment is confirmed. You can leave this screen." : "Finish paying on the payment page. This screen updates when it is confirmed.")}</Text>
            <View style={s.actions}>
              {checkout?.checkoutUrl ? done("Open payment page again", () => void Linking.openURL(checkout.checkoutUrl!).catch(() => undefined)) : null}
              {error || waited ? done("Check again", () => void poll(), true) : null}
              {done("Cancel payment", () => void cancel(), true)}
              {waited ? done("Leave", () => router.replace(origin as never), true) : null}
            </View>
          </>
        )}
      </View>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 12 },
  icon: { width: 104, height: 104, borderRadius: 52, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { color: world.text, fontFamily: fonts.extrabold, fontSize: 22, textAlign: "center" },
  text: { color: world.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  actions: { alignSelf: "stretch", gap: 10, marginTop: 20 },
  btn: { height: 52, borderRadius: 14, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  btnSecondary: { backgroundColor: "#F1EEFF" },
  btnText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 }
});

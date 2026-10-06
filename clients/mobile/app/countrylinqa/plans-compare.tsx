import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { canChoose, formatPrice, safeReturn, type PlanCard, type PlansResponse } from "../../services/countrylinqa-plans";
import { fonts } from "../../theme/tokens";

/** 6.1 Compare Plans. Only a step up from your current plan can be chosen. */
export default function CountryLinqaComparePlans() {
  const router = useRouter();
  const client = useCountryClient();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [data, setData] = useState<PlansResponse | null>(null);
  const [picked, setPicked] = useState<PlanCard["code"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    client.plans().then((p) => { if (active) { setData(p); setPicked((old) => old ?? p.plans.find((x) => canChoose(p.current.tier, x.code))?.code ?? null); } },
      (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load plans"); });
    return () => { active = false; };
  }, [client, reload]));

  const origin = safeReturn(from);
  const plan = data?.plans.find((p) => p.code === picked);
  const canContinue = !!data && !!plan && canChoose(data.current.tier, plan.code) && data.paymentsAvailable;

  return (
    <WorldScreen>
      <WorldHeader title="Compare Plans" back />
      <ScrollView contentContainerStyle={s.content}>
        {error ? <Empty icon="cloud-offline-outline" title="Can not load plans" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
        {!data && !error ? <Spinner /> : null}
        {data ? data.plans.map((p) => {
          const current = p.code === data.current.tier;
          const choosable = canChoose(data.current.tier, p.code);
          const on = picked === p.code && choosable;
          return (
            <Pressable key={p.code} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !choosable }}
              accessibilityLabel={`${p.name}. ${p.reach}. ${p.monthlyPriceMinor ? `${formatPrice(p.monthlyPriceMinor, p.currency)} a month` : "Free"}${current ? ". Your current plan" : ""}`}
              style={[s.card, on && s.cardOn, !choosable && !current && { opacity: 0.55 }]} onPress={() => { if (choosable) setPicked(p.code); }}>
              <View style={[s.mark, current && { backgroundColor: "#12A150", borderColor: "#12A150" }, on && { backgroundColor: world.purple, borderColor: world.purple }]}>
                {current || on ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{p.name}</Text>
                <Text style={s.reach}>{p.reach}</Text>
                {p.monthlyPriceMinor ? <Text style={s.price}>{formatPrice(p.monthlyPriceMinor, p.currency)} / month</Text> : null}
                {on ? p.features.map((f) => <View key={f} style={s.feature}><Ionicons name="checkmark" size={15} color="#12A150" /><Text style={s.featureText}>{f}</Text></View>) : null}
              </View>
              {current ? <Text style={s.tag}>Current</Text> : null}
            </Pressable>
          );
        }) : null}
        {data && !data.paymentsAvailable ? <View style={s.notice}><Ionicons name="information-circle-outline" size={20} color="#7A4B00" /><Text style={s.noticeText}>Payments are not available yet, so plans can not be bought right now. You will not be charged.</Text></View> : null}
        {data && data.current.tier === "ELITE" ? <Text style={s.fine}>You are on the highest plan.</Text> : null}
      </ScrollView>
      <View style={s.footer}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canContinue }} disabled={!canContinue} style={[s.primary, !canContinue && { opacity: 0.45 }]}
          onPress={() => router.push({ pathname: "/countrylinqa/plans-method", params: { plan: picked ?? "", from: origin } })}>
          <Text style={s.primaryText}>Continue</Text>
        </Pressable>
      </View>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 16, gap: 12 },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 14, borderRadius: 16, borderWidth: 1.5, borderColor: world.border, padding: 16 },
  cardOn: { borderColor: world.purple, backgroundColor: "#F8F6FF" },
  mark: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: "#C9CDD8", alignItems: "center", justifyContent: "center", marginTop: 2 },
  name: { color: world.text, fontFamily: fonts.extrabold, fontSize: 18 },
  reach: { color: world.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 3 },
  price: { color: world.purple, fontFamily: fonts.bold, fontSize: 16, marginTop: 6 },
  feature: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  featureText: { color: world.text, fontFamily: fonts.regular, fontSize: 14, flex: 1 },
  tag: { color: "#12805C", backgroundColor: "#E7F6EF", fontFamily: fonts.semibold, fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: "hidden" },
  notice: { flexDirection: "row", gap: 10, backgroundColor: "#FFF6E5", borderRadius: 12, padding: 14 },
  noticeText: { flex: 1, color: "#7A4B00", fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  fine: { color: world.faint, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  footer: { paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8 },
  primary: { height: 54, borderRadius: 14, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 17 }
});

import { useCallback, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { PLAN_COPY, manageSubscriptionTarget, renewalLabel } from "../../services/countrylinqa-settings";
import { fonts } from "../../theme/tokens";

type Sub = Awaited<ReturnType<ReturnType<typeof useCountryClient>["subscription"]>>;

/** 5.4 Plan & Subscription: what the plan allows, as billing last confirmed it. */
export default function CountryLinqaPlan() {
  const router = useRouter();
  const client = useCountryClient();
  const [sub, setSub] = useState<Sub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null); setNote(null);
    client.subscription().then((v) => { if (active) setSub(v); }, (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load your plan"); });
    return () => { active = false; };
  }, [client, reload]));

  const copy = sub ? PLAN_COPY[sub.tier] : null;
  const renews = sub ? renewalLabel(sub.currentPeriodEnd) : null;

  async function manage() {
    if (!sub) return;
    const target = manageSubscriptionTarget(sub.provider);
    if (target.kind === "NONE") { setNote("You do not have a paid subscription to manage."); return; }
    if (target.kind === "SUPPORT") { router.push("/support"); return; }
    try { await Linking.openURL(target.url); } catch { setNote("Unable to open your store's subscription page."); }
  }
  const history = () => {
    if (!sub?.provider) { setNote("There are no payments or receipts yet because you have not subscribed."); return; }
    if (sub.provider === "APPLE" || sub.provider === "GOOGLE") { void manage(); return; }
    router.push("/support");
  };

  return (
    <WorldScreen>
      <WorldHeader title="Plan & Subscription" back />
      <ScrollView contentContainerStyle={s.content}>
        {error ? <Empty icon="cloud-offline-outline" title="Can not load your plan" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
        {!sub && !error ? <Spinner /> : null}
        {sub && copy ? (
          <>
            <View style={s.card}>
              <Text style={s.cardLabel}>Current Plan</Text>
              <View style={s.planRow}><View style={s.crown}><Ionicons name="ribbon" size={26} color="#E5A000" /></View><Text style={s.planName}>{copy.name}</Text></View>
              <Text style={s.reach}>{copy.reach}</Text>
              {renews && sub.tier !== "FREE" ? <Text style={s.meta}>{sub.status === "CANCELLED" ? "Ends" : "Renews"} {renews}</Text> : null}
              {sub.status === "PAST_DUE" || sub.status === "EXPIRED" ? <Text style={s.warn}>Your last payment did not go through, so you are on the Free plan.</Text> : null}
              {copy.upgrade ? <Text style={s.upgrade}>{copy.upgrade}</Text> : null}
            </View>
            {[
              { icon: "git-compare-outline" as const, label: "Compare Plans", onPress: () => router.push({ pathname: "/countrylinqa/plans-compare", params: { from: "/countrylinqa/plan" } }) },
              { icon: "card-outline" as const, label: "Manage Subscription", onPress: () => void manage() },
              { icon: "receipt-outline" as const, label: "Payments & Receipts", onPress: history }
            ].map((r) => (
              <Pressable key={r.label} accessibilityRole="button" style={s.row} onPress={r.onPress}>
                <View style={s.icon}><Ionicons name={r.icon} size={22} color={world.purple} /></View><Text style={s.rowText}>{r.label}</Text><Ionicons name="chevron-forward" size={18} color={world.faint} />
              </Pressable>
            ))}
            {note ? <Text style={s.note} accessibilityLiveRegion="polite">{note}</Text> : null}
            <Text style={s.fine}>Plan access is granted only after billing confirms an active subscription.</Text>
          </>
        ) : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 30, paddingTop: 6 },
  card: { borderRadius: 18, borderWidth: 1, borderColor: world.border, padding: 18, marginBottom: 16 },
  cardLabel: { color: world.text, fontFamily: fonts.extrabold, fontSize: 18 },
  planRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  crown: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#FFF6E5", alignItems: "center", justifyContent: "center" },
  planName: { color: world.purple, fontFamily: fonts.extrabold, fontSize: 24 },
  reach: { color: world.muted, fontFamily: fonts.medium, fontSize: 15, marginTop: 10 },
  meta: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 4 },
  warn: { color: "#B54708", fontFamily: fonts.medium, fontSize: 13, marginTop: 8 },
  upgrade: { color: world.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, marginTop: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1, borderColor: world.border, padding: 12, marginBottom: 10, minHeight: 64 },
  icon: { width: 42, height: 42, borderRadius: 21, backgroundColor: world.soft, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, color: world.purple, fontFamily: fonts.semibold, fontSize: 16 },
  note: { color: world.muted, fontFamily: fonts.medium, fontSize: 14, marginTop: 6 },
  fine: { color: world.faint, fontFamily: fonts.regular, fontSize: 12, textAlign: "center", marginTop: 16 }
});

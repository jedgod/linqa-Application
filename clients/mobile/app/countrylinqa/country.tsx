import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Chip, Empty, PersonRow, Spinner, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { flagOf, formatCount, titleCase, type CountryHub } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

/** 3.5 Country Hub: one country at a glance, and the ways into its people, community, events and businesses. */
export default function CountryLinqaCountryHub() {
  const router = useRouter();
  const client = useCountryClient();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [hub, setHub] = useState<CountryHub | null>(null);
  const [state, setState] = useState<"LOADING" | "READY" | "MISSING" | "ERROR">("LOADING");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    let active = true;
    setState("LOADING"); setNote(null);
    if (!code) { setState("MISSING"); return () => undefined; }
    client.countryHub(code).then(
      (value) => { if (active) { setHub(value); setState("READY"); } },
      (cause) => { if (active) setState(cause instanceof Error && cause.message === "COUNTRY_NOT_FOUND" ? "MISSING" : "ERROR"); }
    );
    return () => { active = false; };
  }, [client, code]);
  useFocusEffect(load);

  async function toggleCommunity() {
    if (!hub || busy) return;
    setBusy(true); setNote(null);
    try {
      if (hub.community.joined) await client.leaveCountryCommunity(hub.country.code); else await client.joinCountryCommunity(hub.country.code);
      const delta = hub.community.joined ? -1 : 1;
      setHub({ ...hub, community: { ...hub.community, joined: !hub.community.joined }, stats: { ...hub.stats, members: Math.max(0, hub.stats.members + delta) } });
    } catch (cause) {
      setNote(cause instanceof Error && cause.message === "COMMUNITY_MEMBERSHIP_SUSPENDED" ? "Your membership in this community is suspended." : "Unable to update your membership. Try again.");
    } finally { setBusy(false); }
  }

  const go = (pathname: string, params: Record<string, string>) => router.push({ pathname, params } as never);
  const name = hub?.country.name ?? "";
  const stats = hub ? [
    { label: "People", value: formatCount(hub.stats.people) },
    { label: "Members", value: formatCount(hub.stats.members) },
    { label: "Events", value: formatCount(hub.stats.events, hub.capped.events) },
    { label: "Businesses", value: formatCount(hub.stats.businesses, hub.capped.businesses) }
  ] : [];
  const buttons = hub ? [
    { label: "People", route: () => go("/countrylinqa/people", { country: hub.country.code, title: name }) },
    { label: "Communities", route: () => go("/countrylinqa/communities", { country: hub.country.code, title: name }) },
    { label: "Events", route: () => go("/countrylinqa/events", { country: hub.country.code, title: name }) },
    { label: "Businesses", route: () => go("/countrylinqa/businesses", { country: hub.country.code, title: name }) }
  ] : [];

  return (
    <WorldScreen>
      <View style={s.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.barBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace("/countrylinqa/countries"))}><Ionicons name="chevron-back" size={26} color={world.text} /></Pressable>
      </View>
      {state === "LOADING" ? <Spinner /> : null}
      {state === "ERROR" ? <Empty icon="cloud-offline-outline" title="Can not load this country" text="Check your connection and try again." action={{ label: "Try again", onPress: () => void load() }} /> : null}
      {state === "MISSING" ? <Empty icon="earth-outline" title="Country not found" text="This country is not available on Linqa." /> : null}
      {state === "READY" && hub ? (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.hero}><Text style={s.flag} accessibilityElementsHidden importantForAccessibility="no">{flagOf(hub.country.code)}</Text></View>
          <Text accessibilityRole="header" style={s.name}>{name}</Text>
          <Text style={s.tag}>Explore {name} on Linqa</Text>

          {!hub.inScope ? (
            <View style={s.out}>
              <Ionicons name="lock-closed-outline" size={22} color="#7A4B00" />
              <Text style={s.outText}>{name} is outside your discovery reach, so its people, events and businesses are hidden. You can widen your reach in discovery settings.</Text>
              <Pressable accessibilityRole="button" style={s.outBtn} onPress={() => router.push("/settings/countrylinqa")}><Text style={s.outBtnText}>Discovery settings</Text></Pressable>
            </View>
          ) : (
            <>
              <View style={s.stats}>
                {stats.map((x) => <View key={x.label} style={s.stat} accessible accessibilityLabel={`${x.value} ${x.label}`}><Text style={s.statValue}>{x.value}</Text><Text style={s.statLabel}>{x.label}</Text></View>)}
              </View>
              <View style={s.buttons}>
                {buttons.map((b) => <Pressable key={b.label} accessibilityRole="button" style={s.button} onPress={b.route}><Text style={s.buttonText}>{b.label}</Text></Pressable>)}
              </View>

              {hub.community.available ? (
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || hub.community.suspended }} disabled={busy || hub.community.suspended} style={[s.join, hub.community.joined && s.joined]} onPress={() => void toggleCommunity()}>
                  <Ionicons name={hub.community.joined ? "checkmark" : "add"} size={18} color={hub.community.joined ? world.purple : "#FFFFFF"} />
                  <Text style={[s.joinText, hub.community.joined && { color: world.purple }]}>{hub.community.suspended ? "Membership suspended" : busy ? "Updating…" : hub.community.joined ? "Joined the community" : `Join the ${name} community`}</Text>
                </Pressable>
              ) : null}
              {note ? <Text style={s.error} accessibilityLiveRegion="polite">{note}</Text> : null}

              <Text style={s.section}>Trending in {name}</Text>
              {hub.trending.length ? (
                <View style={s.chips}>{hub.trending.map((t) => <Chip key={t.tag} label={`#${titleCase(t.tag)}`} onPress={() => go("/countrylinqa/people", { country: hub.country.code, interest: t.tag, title: `#${titleCase(t.tag)}` })} />)}</View>
              ) : <Text style={s.muted}>Nothing is trending yet.</Text>}

              <Text style={s.section}>Featured People</Text>
              {hub.featured.length ? hub.featured.map((p) => (
                <PersonRow key={p.id} person={p} onOpen={() => go("/countrylinqa/person", { id: p.id })} action={{ label: "View", onPress: () => go("/countrylinqa/person", { id: p.id }) }} />
              )) : <Text style={s.muted}>No one to feature yet.</Text>}
            </>
          )}
        </ScrollView>
      ) : null}
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  bar: { paddingHorizontal: 8, paddingTop: 6 },
  barBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 22, paddingBottom: 32 },
  hero: { height: 170, borderRadius: 24, backgroundColor: "#EAF3FF", alignItems: "center", justifyContent: "center" },
  flag: { fontSize: 96 },
  name: { color: world.purple, fontFamily: fonts.extrabold, fontSize: 30, textAlign: "center", marginTop: 14 },
  tag: { color: world.purple, fontFamily: fonts.medium, fontSize: 15, textAlign: "center", marginTop: 2 },
  stats: { flexDirection: "row", marginTop: 18 },
  stat: { flex: 1, alignItems: "center" },
  statValue: { color: world.text, fontFamily: fonts.extrabold, fontSize: 19 },
  statLabel: { color: world.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 18 },
  button: { width: "47.5%", minHeight: 46, borderRadius: 23, borderWidth: 1.5, borderColor: "#C9C0FF", alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  buttonText: { color: world.purple, fontFamily: fonts.semibold, fontSize: 15 },
  join: { flexDirection: "row", gap: 8, minHeight: 50, borderRadius: 14, backgroundColor: world.purple, alignItems: "center", justifyContent: "center", marginTop: 16 },
  joined: { backgroundColor: world.soft },
  joinText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 15 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 10, textAlign: "center" },
  section: { color: world.purple, fontFamily: fonts.extrabold, fontSize: 18, marginTop: 24, marginBottom: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  muted: { color: world.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  out: { backgroundColor: "#FFF6E5", borderRadius: 16, padding: 16, gap: 10, marginTop: 20 },
  outText: { color: "#7A4B00", fontFamily: fonts.medium, fontSize: 14, lineHeight: 21 },
  outBtn: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  outBtnText: { color: world.purple, fontFamily: fonts.bold, fontSize: 15 }
});

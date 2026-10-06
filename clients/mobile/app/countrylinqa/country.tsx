import { useCallback, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Chip, Empty, Spinner, VerifiedBadge, world } from "../../components/countrylinqa/WorldUI";
import { heroFor } from "../../components/countrylinqa/countryHeroes";
import { Avatar } from "../../components/linqasend/ui";
import { flagOf, formatCount, headline, locationLine, titleCase, type CountryHub } from "../../services/countrylinqa-world";
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
    { label: "People", value: formatCount(hub.stats.people), icon: "people" as const, color: "#5B3FE0" },
    { label: "Members", value: formatCount(hub.stats.members), icon: "chatbubbles" as const, color: "#12A58C" },
    { label: "Events", value: formatCount(hub.stats.events, hub.capped.events), icon: "calendar" as const, color: "#2F7BEA" },
    { label: "Businesses", value: formatCount(hub.stats.businesses, hub.capped.businesses), icon: "storefront" as const, color: "#EA580C" }
  ] : [];
  const buttons = hub ? [
    { label: "People", icon: "person" as const, color: "#2F46E5", route: () => go("/countrylinqa/people", { country: hub.country.code, title: name }) },
    { label: "Communities", icon: "people" as const, color: "#12A58C", route: () => go("/countrylinqa/communities", { country: hub.country.code, title: name }) },
    { label: "Events", icon: "calendar" as const, color: "#E11D48", route: () => go("/countrylinqa/events", { country: hub.country.code, title: name }) },
    { label: "Businesses", icon: "storefront" as const, color: "#EA580C", route: () => go("/countrylinqa/businesses", { country: hub.country.code, title: name }) }
  ] : [];

  const back = () => (router.canGoBack() ? router.back() : router.replace("/countrylinqa/countries"));
  const photo = hub ? heroFor(hub.country.code) : null;
  return (
    <View style={s.screen}>
      <StatusBar style={state === "READY" ? "light" : "dark"} />
      {state === "READY" && hub ? (
        <>
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <View style={s.hero}>
              {photo ? <Image source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : (
                <>
                  <View style={s.glow} />
                  <Text style={s.bigFlag} accessibilityElementsHidden importantForAccessibility="no">{flagOf(hub.country.code)}</Text>
                </>
              )}
            </View>
            <View style={s.sheet}>
              <View style={s.flagCard} accessibilityElementsHidden importantForAccessibility="no"><Text style={s.flagEmoji}>{flagOf(hub.country.code)}</Text></View>
              <Text accessibilityRole="header" style={s.name}>{name}</Text>
              <Text style={s.tag}>Explore {name} on Linqa</Text>
              <Text style={s.blurb}>Connect with people, communities, events and businesses from {name} and around the world.</Text>

              {!hub.inScope ? (
                <View style={s.out}>
                  <Ionicons name="lock-closed-outline" size={22} color="#7A4B00" />
                  <Text style={s.outText}>{name} is outside your discovery reach, so its people, events and businesses are hidden. You can widen your reach in discovery settings.</Text>
                  <Pressable accessibilityRole="button" style={s.outBtn} onPress={() => router.push("/settings/countrylinqa")}><Text style={s.outBtnText}>Discovery settings</Text></Pressable>
                </View>
              ) : (
                <>
                  <View style={s.stats}>
                    {stats.map((x, i) => (
                      <View key={x.label} style={[s.stat, i > 0 && s.statDivider]} accessible accessibilityLabel={`${x.value} ${x.label}`}>
                        <View style={s.statTop}><Ionicons name={x.icon} size={20} color={x.color} /><Text style={s.statValue}>{x.value}</Text></View>
                        <Text style={s.statLabel}>{x.label}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={s.buttons}>
                    {buttons.map((b) => (
                      <Pressable key={b.label} accessibilityRole="button" style={s.button} onPress={b.route}>
                        <Ionicons name={b.icon} size={24} color={b.color} /><Text style={s.buttonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{b.label}</Text><Ionicons name="chevron-forward" size={18} color={world.faint} />
                      </Pressable>
                    ))}
                  </View>

                  <View style={s.sectionRow}><Text style={s.section}>Trending in {name}</Text></View>
                  {hub.trending.length ? (
                    <View style={s.chips}>{hub.trending.map((t) => <Chip key={t.tag} label={`#${titleCase(t.tag)}`} onPress={() => go("/countrylinqa/people", { country: hub.country.code, interest: t.tag, title: `#${titleCase(t.tag)}` })} />)}</View>
                  ) : <Text style={s.muted}>Nothing is trending yet.</Text>}

                  <View style={s.sectionRow}>
                    <Text style={s.section}>Featured People</Text>
                    <Pressable accessibilityRole="button" onPress={() => go("/countrylinqa/people", { country: hub.country.code, title: name })}><Text style={s.seeAll}>See All ›</Text></Pressable>
                  </View>
                  {hub.featured.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 22 }} style={{ marginHorizontal: -22 }}>
                      {hub.featured.map((p) => (
                        <View key={p.id} style={s.person}>
                          <View style={s.personTop}>
                            <Avatar name={p.displayName} size={58} />
                            <View style={{ flex: 1 }}>
                              {p.verified ? <VerifiedBadge /> : null}
                              <Text style={s.personName} numberOfLines={1}>{p.displayName}</Text>
                            </View>
                          </View>
                          <Text style={s.personMeta} numberOfLines={1}>{locationLine(p) || " "}</Text>
                          <Text style={s.personMeta} numberOfLines={1}>{headline(p) || " "}</Text>
                          <Pressable accessibilityRole="button" accessibilityLabel={`View ${p.displayName}`} style={s.view} onPress={() => go("/countrylinqa/person", { id: p.id })}><Text style={s.viewText}>View</Text></Pressable>
                        </View>
                      ))}
                    </ScrollView>
                  ) : <Text style={s.muted}>No one to feature yet.</Text>}

                  {hub.community.available ? (
                    <>
                      <View style={s.sectionRow}><Text style={s.section}>Community</Text></View>
                      <View style={s.community}>
                        <View style={s.communityIcon}><Text style={{ fontSize: 30 }}>{flagOf(hub.country.code)}</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.personName} numberOfLines={1}>{name} Community</Text>
                          <Text style={s.personMeta}>{formatCount(hub.stats.members)} {hub.stats.members === 1 ? "member" : "members"}</Text>
                        </View>
                        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || hub.community.suspended }} disabled={busy || hub.community.suspended} style={[s.joinBtn, hub.community.joined && s.joined]} onPress={() => void toggleCommunity()}>
                          <Text style={[s.joinText, hub.community.joined && { color: world.purple }]}>{hub.community.suspended ? "Suspended" : busy ? "…" : hub.community.joined ? "Joined" : "Join"}</Text>
                        </Pressable>
                      </View>
                      {note ? <Text style={s.error} accessibilityLiveRegion="polite">{note}</Text> : null}
                    </>
                  ) : null}
                </>
              )}
            </View>
          </ScrollView>
          <SafeAreaView edges={["top"]} style={s.overlay} pointerEvents="box-none">
            <View style={s.overlayRow} pointerEvents="box-none">
              <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.round} onPress={back}><Ionicons name="chevron-back" size={24} color="#FFFFFF" /></Pressable>
              <View style={{ flex: 1 }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Search" style={s.round} onPress={() => router.push("/countrylinqa/search")}><Ionicons name="search" size={21} color="#FFFFFF" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Manage countries" style={[s.round, { marginLeft: 10 }]} onPress={() => router.push("/countrylinqa/manage-countries")}><Ionicons name="ellipsis-horizontal" size={21} color="#FFFFFF" /></Pressable>
            </View>
          </SafeAreaView>
        </>
      ) : (
        <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.barBtn} onPress={back}><Ionicons name="chevron-back" size={26} color={world.text} /></Pressable>
          {state === "LOADING" ? <Spinner /> : null}
          {state === "ERROR" ? <Empty icon="cloud-offline-outline" title="Can not load this country" text="Check your connection and try again." action={{ label: "Try again", onPress: () => void load() }} /> : null}
          {state === "MISSING" ? <Empty icon="earth-outline" title="Country not found" text="This country is not available on Linqa." /> : null}
        </SafeAreaView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  barBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginLeft: 8, marginTop: 8 },
  content: { paddingBottom: 40 },
  hero: { height: 300, backgroundColor: "#3B2BB5", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  glow: { position: "absolute", width: 440, height: 440, borderRadius: 220, backgroundColor: "#7C66F0", opacity: 0.5, top: -150, left: -110 },
  bigFlag: { fontSize: 190, opacity: 0.32, marginBottom: 40 },
  sheet: { marginTop: -44, backgroundColor: "#FFFFFF", borderTopLeftRadius: 40, borderTopRightRadius: 40, paddingHorizontal: 22, paddingTop: 52 },
  flagCard: { position: "absolute", top: -42, alignSelf: "center", width: 88, height: 70, borderRadius: 16, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#101828", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  flagEmoji: { fontSize: 46 },
  name: { color: "#0F1B4D", fontFamily: fonts.extrabold, fontSize: 32, textAlign: "center" },
  tag: { color: "#4B4F7A", fontFamily: fonts.bold, fontSize: 18, textAlign: "center", marginTop: 2 },
  blurb: { color: world.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 8 },
  stats: { flexDirection: "row", backgroundColor: "#F5F6FB", borderRadius: 18, paddingVertical: 14, marginTop: 20 },
  stat: { flex: 1, alignItems: "center" },
  statDivider: { borderLeftWidth: 1, borderLeftColor: world.border },
  statTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  statValue: { color: world.text, fontFamily: fonts.extrabold, fontSize: 18 },
  statLabel: { color: world.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
  button: { width: "47.8%", minHeight: 58, borderRadius: 16, borderWidth: 1, borderColor: world.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, backgroundColor: "#FFFFFF" },
  buttonText: { flex: 1, color: world.text, fontFamily: fonts.bold, fontSize: 14 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 12 },
  section: { color: "#0F1B4D", fontFamily: fonts.extrabold, fontSize: 21 },
  seeAll: { color: world.purple, fontFamily: fonts.semibold, fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  muted: { color: world.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  person: { width: 200, borderRadius: 18, borderWidth: 1, borderColor: world.border, padding: 12, backgroundColor: "#FFFFFF" },
  personTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  personName: { color: world.text, fontFamily: fonts.bold, fontSize: 15 },
  personMeta: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  view: { minHeight: 42, borderRadius: 10, backgroundColor: world.purple, alignItems: "center", justifyContent: "center", marginTop: 12 },
  viewText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 15 },
  community: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, borderWidth: 1, borderColor: world.border, padding: 12 },
  communityIcon: { width: 60, height: 60, borderRadius: 14, backgroundColor: "#EAF3FF", alignItems: "center", justifyContent: "center" },
  joinBtn: { minWidth: 82, minHeight: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  joined: { backgroundColor: world.soft },
  joinText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 14 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 10, textAlign: "center" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0 },
  overlayRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8 },
  round: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(0,0,0,0.38)", alignItems: "center", justifyContent: "center" },
  out: { backgroundColor: "#FFF6E5", borderRadius: 16, padding: 16, gap: 10, marginTop: 20 },
  outText: { color: "#7A4B00", fontFamily: fonts.medium, fontSize: 14, lineHeight: 21 },
  outBtn: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  outBtnText: { color: world.purple, fontFamily: fonts.bold, fontSize: 15 }
});

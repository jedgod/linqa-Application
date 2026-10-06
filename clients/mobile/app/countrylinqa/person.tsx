import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Chip, Empty, Spinner, VerifiedBadge, useMessage, world } from "../../components/countrylinqa/WorldUI";
import { Avatar } from "../../components/linqasend/ui";
import { connectLabel, flagOf, headline, locationLine, titleCase, type PersonDetail } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

/** 3.3 Person Profile: a hero up top, a rounded sheet with who they are (as much as they chose to show), Message, Connect, About, Interests, and Report / Block. */
export default function CountryLinqaPerson() {
  const router = useRouter();
  const client = useCountryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [state, setState] = useState<"LOADING" | "READY" | "MISSING" | "ERROR">("LOADING");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const chat = useMessage();

  useFocusEffect(useCallback(() => {
    let active = true;
    setState("LOADING"); setNote(null);
    if (!id) { setState("MISSING"); return; }
    client.peopleDetails([id]).then(
      (rows) => { if (!active) return; setPerson(rows[0] ?? null); setState(rows[0] ? "READY" : "MISSING"); },
      () => { if (active) setState("ERROR"); }
    );
    return () => { active = false; };
  }, [client, id]));

  async function connect() {
    if (!person || busy) return;
    const action = connectLabel(person.connection);
    if (action.action === "RESPOND") { router.push("/countrylinqa/connections"); return; }
    if (action.action !== "CONNECT") return;
    setBusy(true); setNote(null);
    try {
      const result = await client.connect(person.id);
      setPerson({ ...person, connection: { id: result.id, status: result.status === "ACCEPTED" ? "ACCEPTED" : "PENDING", incoming: false } });
    } catch (cause) {
      setNote(cause instanceof Error && cause.message === "PERSON_UNAVAILABLE" ? "This person can not be reached right now." : "Unable to send the request. Try again.");
    } finally { setBusy(false); }
  }

  const report = () => { if (person) router.push({ pathname: "/countrylinqa/report", params: { subjectId: person.id, subjectType: "USER" } }); };
  function block() {
    if (!person) return;
    Alert.alert(`Block ${person.displayName}?`, "They will not be able to find or message you, and you will not see them in CountryLinqa. You can unblock them any time in Blocked Accounts.", [
      { text: "Cancel", style: "cancel" },
      { text: "Block", style: "destructive", onPress: () => {
        setNote(null);
        client.blockUser(person.id).then(
          () => (router.canGoBack() ? router.back() : router.replace("/countrylinqa/world")),
          () => setNote("Unable to block this person. Try again.")
        );
      } }
    ]);
  }
  const more = () => Alert.alert(person?.displayName ?? "Profile", undefined, [
    { text: "Report", onPress: report },
    { text: "Block", style: "destructive", onPress: block },
    { text: "Cancel", style: "cancel" }
  ]);
  const back = () => (router.canGoBack() ? router.back() : router.replace("/countrylinqa/people"));

  const connection = person ? connectLabel(person.connection) : null;
  const where = person ? locationLine(person) : "";
  return (
    <View style={s.screen}>
      <StatusBar style={state === "READY" ? "light" : "dark"} />
      {state === "READY" && person ? (
        <>
          <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: 96 }} showsVerticalScrollIndicator={false}>
            <View style={s.hero}>
              <View style={s.heroGlow} />
              <Avatar name={person.displayName} size={170} />
            </View>
            <View style={s.sheet}>
              <View style={s.nameLine}><Text accessibilityRole="header" style={s.name} numberOfLines={2}>{person.displayName}</Text>{person.verified ? <VerifiedBadge /> : null}</View>
              {where ? <Text style={s.where}>{person.countryCode ? `${flagOf(person.countryCode)}  ` : ""}{where}</Text> : null}
              {headline(person) ? <Text style={s.meta}>{headline(person)}</Text> : null}

              <View style={s.actions}>
                <Pressable accessibilityRole="button" style={s.primary} onPress={() => chat.message(person.id, person.displayName)}>
                  <Ionicons name="chatbubble-outline" size={20} color="#FFFFFF" /><Text style={s.primaryText}>Message</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || connection?.action === "NONE" }} disabled={busy || connection?.action === "NONE"} style={[s.secondary, connection?.action === "NONE" && { opacity: 0.7 }]} onPress={() => void connect()}>
                  <Ionicons name={person.connection?.status === "ACCEPTED" ? "checkmark" : "person-add"} size={20} color={world.purple} />
                  <Text style={s.secondaryText}>{busy ? "Sending…" : connection?.label}</Text>
                </Pressable>
              </View>
              {note ? <Text style={s.error} accessibilityLiveRegion="polite">{note}</Text> : null}

              <View style={s.rule} />
              <Text style={s.section}>About</Text>
              <Text style={s.aboutText}>{person.bio?.trim() ? person.bio : `${person.displayName.split(" ")[0]} has not added a bio yet.`}</Text>

              {person.interests.length ? (
                <>
                  <Text style={[s.section, { marginTop: 24 }]}>Interests</Text>
                  <View style={s.chips}>{person.interests.map((interest) => <Chip key={interest} label={titleCase(interest)} onPress={() => router.push({ pathname: "/countrylinqa/people", params: { interest, title: `#${titleCase(interest)}` } })} />)}</View>
                </>
              ) : null}
            </View>
          </ScrollView>

          <SafeAreaView edges={["top"]} style={s.overlay} pointerEvents="box-none">
            <View style={s.overlayRow} pointerEvents="box-none">
              <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.round} onPress={back}><Ionicons name="chevron-back" size={24} color="#FFFFFF" /></Pressable>
              <View style={{ flex: 1 }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Search" style={s.round} onPress={() => router.push("/countrylinqa/search")}><Ionicons name="search" size={21} color="#FFFFFF" /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="More options" style={[s.round, { marginLeft: 10 }]} onPress={more}><Ionicons name="ellipsis-vertical" size={21} color="#FFFFFF" /></Pressable>
            </View>
          </SafeAreaView>

          <SafeAreaView edges={["bottom"]} style={s.footer}>
            <Pressable accessibilityRole="button" style={s.footBtn} onPress={report}><Ionicons name="flag-outline" size={22} color={world.muted} /><Text style={s.reportText}>Report</Text></Pressable>
            <View style={s.footDivider} />
            <Pressable accessibilityRole="button" style={s.footBtn} onPress={block}><Ionicons name="ban-outline" size={22} color="#E5251B" /><Text style={s.blockText}>Block</Text></Pressable>
          </SafeAreaView>
        </>
      ) : (
        <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.plainBack} onPress={back}><Ionicons name="chevron-back" size={26} color={world.text} /></Pressable>
          {state === "LOADING" ? <Spinner /> : null}
          {state === "ERROR" ? <Empty icon="cloud-offline-outline" title="Can not load this profile" text="Check your connection and try again." action={{ label: "Try again", onPress: () => router.replace({ pathname: "/countrylinqa/person", params: { id: id ?? "" } }) }} /> : null}
          {state === "MISSING" ? <Empty icon="person-outline" title="Profile not available" text="This person is outside your discovery reach, or has chosen not to be found." /> : null}
        </SafeAreaView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  hero: { height: 340, backgroundColor: "#4B34C9", alignItems: "center", justifyContent: "center", paddingBottom: 40, overflow: "hidden" },
  heroGlow: { position: "absolute", width: 420, height: 420, borderRadius: 210, backgroundColor: "#7C66F0", opacity: 0.55, top: -90, right: -120 },
  sheet: { marginTop: -34, backgroundColor: "#FFFFFF", borderTopLeftRadius: 34, borderTopRightRadius: 34, paddingHorizontal: 22, paddingTop: 24 },
  nameLine: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  name: { color: "#0F1B4D", fontFamily: fonts.extrabold, fontSize: 28, textAlign: "center", flexShrink: 1 },
  where: { color: world.muted, fontFamily: fonts.medium, fontSize: 16, textAlign: "center", marginTop: 6 },
  meta: { color: world.muted, fontFamily: fonts.regular, fontSize: 15, textAlign: "center", marginTop: 4 },
  actions: { flexDirection: "row", gap: 12, marginTop: 22 },
  primary: { flex: 1, minHeight: 54, borderRadius: 14, backgroundColor: world.purple, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 17 },
  secondary: { flex: 1, minHeight: 54, borderRadius: 14, borderWidth: 1.5, borderColor: world.purple, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  secondaryText: { color: world.purple, fontFamily: fonts.bold, fontSize: 17 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 12, textAlign: "center" },
  rule: { height: 1, backgroundColor: world.border, marginTop: 22, marginBottom: 20 },
  section: { color: "#0F1B4D", fontFamily: fonts.extrabold, fontSize: 20, marginBottom: 10 },
  aboutText: { color: world.muted, fontFamily: fonts.regular, fontSize: 16, lineHeight: 25 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0 },
  overlayRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8 },
  round: { width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(0,0,0,0.38)", alignItems: "center", justifyContent: "center" },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: world.border, paddingHorizontal: 22 },
  footBtn: { flex: 1, minHeight: 60, flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center" },
  footDivider: { width: 1, height: 34, backgroundColor: world.border },
  reportText: { color: world.muted, fontFamily: fonts.semibold, fontSize: 17 },
  blockText: { color: "#E5251B", fontFamily: fonts.bold, fontSize: 17 },
  plainBack: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginLeft: 8, marginTop: 8 }
});

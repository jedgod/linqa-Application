import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Chip, Empty, Spinner, VerifiedBadge, WorldScreen, useMessage, world } from "../../components/countrylinqa/WorldUI";
import { Avatar } from "../../components/linqasend/ui";
import { connectLabel, flagOf, headline, locationLine, titleCase, type PersonDetail } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

/** 3.3 Person Profile: who they are (as much as they chose to show), Message, Connect, About, Interests. */
export default function CountryLinqaPerson() {
  const router = useRouter();
  const client = useCountryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [state, setState] = useState<"LOADING" | "READY" | "MISSING" | "ERROR">("LOADING");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const chat = useMessage((conversationId) => router.push({ pathname: "/modules/conversation", params: { conversationId } }));

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

  const connection = person ? connectLabel(person.connection) : null;
  return (
    <WorldScreen>
      <View style={s.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.barBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace("/countrylinqa/people"))}><Ionicons name="chevron-back" size={26} color={world.text} /></Pressable>
        <View style={{ flex: 1 }} />
        {person ? <Pressable accessibilityRole="button" accessibilityLabel="Report this person" style={s.barBtn} onPress={() => router.push({ pathname: "/countrylinqa/report", params: { subjectId: person.id, subjectType: "USER" } })}><Ionicons name="flag-outline" size={22} color={world.muted} /></Pressable> : null}
      </View>
      {state === "LOADING" ? <Spinner /> : null}
      {state === "ERROR" ? <Empty icon="cloud-offline-outline" title="Can not load this profile" text="Check your connection and try again." action={{ label: "Try again", onPress: () => router.replace({ pathname: "/countrylinqa/person", params: { id: id ?? "" } }) }} /> : null}
      {state === "MISSING" ? <Empty icon="person-outline" title="Profile not available" text="This person is outside your discovery reach, or has chosen not to be found." /> : null}
      {state === "READY" && person ? (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.hero}>
            <Avatar name={person.displayName} size={132} />
            {person.countryCode ? <Text style={s.heroFlag} accessibilityElementsHidden importantForAccessibility="no">{flagOf(person.countryCode)}</Text> : null}
          </View>
          <View style={s.nameLine}><Text accessibilityRole="header" style={s.name}>{person.displayName}</Text>{person.verified ? <VerifiedBadge /> : null}</View>
          {locationLine(person) ? <Text style={s.meta}>{person.countryCode ? `${flagOf(person.countryCode)} ` : ""}{locationLine(person)}</Text> : null}
          {headline(person) ? <Text style={s.meta}>{headline(person)}</Text> : null}

          <View style={s.actions}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!chat.busy }} disabled={!!chat.busy} style={s.primary} onPress={() => chat.message(person.id, person.displayName)}><Text style={s.primaryText}>{chat.busy ? "Opening…" : "Message"}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || connection?.action === "NONE" }} disabled={busy || connection?.action === "NONE"} style={[s.secondary, connection?.action === "NONE" && { opacity: 0.7 }]} onPress={() => void connect()}>
              <Ionicons name={person.connection?.status === "ACCEPTED" ? "checkmark" : "person-add-outline"} size={18} color={world.purple} />
              <Text style={s.secondaryText}>{busy ? "Sending…" : connection?.label}</Text>
            </Pressable>
          </View>
          {chat.error ? <Text style={s.error} accessibilityLiveRegion="polite">{chat.error}</Text> : null}
          {note ? <Text style={s.error} accessibilityLiveRegion="polite">{note}</Text> : null}

          <Text style={s.section}>About</Text>
          <View style={s.about}><Text style={s.aboutText}>{person.bio?.trim() ? person.bio : `${person.displayName.split(" ")[0]} has not added a bio yet.`}</Text></View>

          {person.interests.length ? (
            <>
              <Text style={s.section}>Interests</Text>
              <View style={s.chips}>{person.interests.map((interest) => <Chip key={interest} label={titleCase(interest)} onPress={() => router.push({ pathname: "/countrylinqa/people", params: { interest, title: `#${titleCase(interest)}` } })} />)}</View>
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: 8 },
  barBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 22, paddingBottom: 32 },
  hero: { alignSelf: "stretch", height: 200, borderRadius: 24, backgroundColor: "#EEF0FF", alignItems: "center", justifyContent: "center", marginTop: 4 },
  heroFlag: { position: "absolute", right: 16, bottom: 12, fontSize: 28 },
  nameLine: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18 },
  name: { color: world.purple, fontFamily: fonts.extrabold, fontSize: 25 },
  meta: { color: world.muted, fontFamily: fonts.regular, fontSize: 14, textAlign: "center", marginTop: 4 },
  actions: { flexDirection: "row", gap: 12, marginTop: 20 },
  primary: { flex: 1, minHeight: 52, borderRadius: 14, backgroundColor: world.purple, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 },
  secondary: { flex: 1, minHeight: 52, borderRadius: 14, borderWidth: 1.5, borderColor: "#D9D2FF", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  secondaryText: { color: world.purple, fontFamily: fonts.bold, fontSize: 16 },
  error: { color: world.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 12, textAlign: "center" },
  section: { color: world.text, fontFamily: fonts.extrabold, fontSize: 18, marginTop: 24, marginBottom: 10 },
  about: { backgroundColor: "#F5F6FB", borderRadius: 14, padding: 16 },
  aboutText: { color: "#344054", fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 }
});

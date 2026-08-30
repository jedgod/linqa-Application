import { useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CountryLinqaService } from "../../services/countrylinqa.service";
import { accessTokenProvider } from "../../services/session";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";

export default function CountryLinqaCreateScreen() {
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type?: string }>();
  const event = type === "event";
  const client = useMemo(() => new CountryLinqaService(API, () => accessTokenProvider.getAccessToken()), []);
  const [body, setBody] = useState("");
  const [city, setCity] = useState("");
  const [startsAt, setStartsAt] = useState(new Date(Date.now() + 86_400_000).toISOString());
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!body.trim()) return;
    if (event && (!Number.isFinite(Date.parse(startsAt)) || Date.parse(startsAt) <= Date.now())) {
      Alert.alert("Check the date", "Enter a valid future date and time in ISO format.");
      return;
    }
    setSaving(true);
    try {
      if (event) await client.createEvent({ title: body.trim(), startsAt, ...(city.trim() ? { city: city.trim() } : {}) });
      else await client.createPost(body.trim());
      router.replace({ pathname: "/countrylinqa/list", params: { kind: event ? "events" : "feed", title: event ? "Events" : "World Feed" } });
    } catch (error) {
      Alert.alert("Unable to publish", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()}><Text style={s.cancel}>Cancel</Text></Pressable>
        <Text style={s.title}>{event ? "Create event" : "Create post"}</Text>
        <Pressable disabled={saving || !body.trim()} onPress={() => void submit()}>
          <Text style={[s.publish, (saving || !body.trim()) && s.disabled]}>{saving ? "Saving" : "Publish"}</Text>
        </Pressable>
      </View>
      <TextInput
        autoFocus
        multiline
        value={body}
        onChangeText={setBody}
        maxLength={event ? 200 : 5000}
        placeholder={event ? "Event title" : "What would you like to share?"}
        placeholderTextColor="#8B90A5"
        style={s.editor}
      />
      {event ? (
        <View style={s.eventFields}>
          <Text style={s.label}>Starts at (ISO date and time)</Text>
          <TextInput value={startsAt} onChangeText={setStartsAt} autoCapitalize="none" style={s.input} />
          <Text style={s.label}>City (optional)</Text>
          <TextInput value={city} onChangeText={setCity} maxLength={120} placeholder="City" placeholderTextColor="#8B90A5" style={s.input} />
        </View>
      ) : null}
      <Text style={s.notice}>Your verified CountryLinqa location and audience settings determine where this appears.</Text>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F8FC", padding: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 },
  cancel: { color: "#596078", fontWeight: "700" },
  title: { color: "#171A35", fontSize: 18, fontWeight: "900" },
  publish: { color: "#5B4CFF", fontWeight: "900" },
  disabled: { opacity: 0.4 },
  editor: { minHeight: 150, borderRadius: 18, padding: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E5EE", color: "#171A35", fontSize: 17, textAlignVertical: "top" },
  eventFields: { marginTop: 16, gap: 8 },
  label: { color: "#555C76", fontSize: 12, fontWeight: "800", marginTop: 5 },
  input: { height: 48, borderRadius: 14, paddingHorizontal: 13, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E5EE", color: "#171A35" },
  notice: { color: "#737991", fontSize: 12, lineHeight: 18, marginTop: 18 }
});

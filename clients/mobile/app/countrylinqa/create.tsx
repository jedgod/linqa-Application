import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useCountryClient } from "../../components/CountryLinqaUI";

export default function CountryLinqaCreateScreen() {
  const router = useRouter();
  const { type, title, startsAt: startsAtParam, city: cityParam } =
    useLocalSearchParams<{ type?: string; title?: string; startsAt?: string; city?: string }>();
  const event = type === "event";
  const client = useCountryClient();
  const [body, setBody] = useState(title ?? "");
  const [city, setCity] = useState(cityParam ?? "");
  const [startsAt, setStartsAt] = useState(
    startsAtParam && Number.isFinite(Date.parse(startsAtParam))
      ? startsAtParam
      : new Date(Date.now() + 86_400_000).toISOString()
  );
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setBody(title ?? ""); setCity(cityParam ?? "");
    setStartsAt(startsAtParam && Number.isFinite(Date.parse(startsAtParam)) ? startsAtParam : new Date(Date.now() + 86_400_000).toISOString());
    setSaving(false);
  }, [client, title, cityParam, startsAtParam]);
  const canPublish = body.trim().length > 0 && !saving;
  // Closing (the X, or the phone's back button) returns to Home, wherever this page was opened from.
  const close = () => router.replace("/(tabs)/home");
  const startDate = new Date(Number.isFinite(Date.parse(startsAt)) ? startsAt : Date.now() + 86_400_000);
  const dateLabel = startDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const timeLabel = startDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  // Pick the day first, then the time; the result is kept as the ISO timestamp the server expects.
  function pickDate() {
    if (Platform.OS !== "android") return;
    DateTimePickerAndroid.open({ value: startDate, mode: "date", minimumDate: new Date(), onChange: (_event, picked) => {
      if (!picked) return;
      const next = new Date(startDate); next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      setStartsAt(next.toISOString());
    } });
  }
  function pickTime() {
    if (Platform.OS !== "android") return;
    DateTimePickerAndroid.open({ value: startDate, mode: "time", onChange: (_event, picked) => {
      if (!picked) return;
      const next = new Date(startDate); next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      setStartsAt(next.toISOString());
    } });
  }

  async function submit() {
    if (!body.trim()) return;
    if (event && (!Number.isFinite(Date.parse(startsAt)) || Date.parse(startsAt) <= Date.now())) {
      Alert.alert("Check the date", "Choose a date and time in the future.");
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
        <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={s.closeButton}>
          <Ionicons name="close" size={28} color="#171A35" />
        </Pressable>
        <Text style={s.title}>{event ? "Create event" : "Create post"}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={event ? "Publish event" : "Publish post"}
          accessibilityState={{ disabled: !canPublish }}
          disabled={!canPublish}
          onPress={() => void submit()}
          style={[s.publishButton, !canPublish && s.publishButtonDisabled]}
        >
          <Text style={s.publish}>{saving ? "Saving" : "Publish"}</Text>
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
          <Text style={s.label}>Starts</Text>
          <View style={s.pickRow}>
            <Pressable onPress={pickDate} accessibilityRole="button" accessibilityLabel={`Date, ${dateLabel}`} style={[s.input, s.pick]}>
              <Ionicons name="calendar-outline" size={20} color="#5B4CFF" /><Text style={s.pickText}>{dateLabel}</Text>
            </Pressable>
            <Pressable onPress={pickTime} accessibilityRole="button" accessibilityLabel={`Time, ${timeLabel}`} style={[s.input, s.pick, { flex: 0, minWidth: 130 }]}>
              <Ionicons name="time-outline" size={20} color="#5B4CFF" /><Text style={s.pickText}>{timeLabel}</Text>
            </Pressable>
          </View>
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
  closeButton: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  pickRow: { flexDirection: "row", gap: 10 },
  pick: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  pickText: { color: "#171A35", fontWeight: "700" },
  title: { color: "#171A35", fontSize: 18, fontWeight: "900" },
  publishButton: {
    minWidth: 92,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "#5B4CFF",
    alignItems: "center",
    justifyContent: "center"
  },
  publishButtonDisabled: { backgroundColor: "#A8A2F5" },
  publish: { color: "#FFFFFF", fontWeight: "900" },
  editor: { minHeight: 150, borderRadius: 18, padding: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E5EE", color: "#171A35", fontSize: 17, textAlignVertical: "top" },
  eventFields: { marginTop: 16, gap: 8 },
  label: { color: "#555C76", fontSize: 12, fontWeight: "800", marginTop: 5 },
  input: { height: 48, borderRadius: 14, paddingHorizontal: 13, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E5EE", color: "#171A35" },
  notice: { color: "#737991", fontSize: 12, lineHeight: 18, marginTop: 18 }
});

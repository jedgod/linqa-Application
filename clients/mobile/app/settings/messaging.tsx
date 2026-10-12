import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { loadEnterSends, saveEnterSends } from "../../services/messaging-prefs";

/** How typing works in chats. The same "Enter to send" choice exists on Linqa for computers. */
export default function MessagingSettingsScreen() {
  const router = useRouter();
  const [enterSends, setEnterSends] = useState(false);
  const [error, setError] = useState("");
  const [busy,setBusy]=useState(true);

  useEffect(() => { let live=true;void loadEnterSends().then(value=>{if(live){setEnterSends(value);setBusy(false);}});return()=>{live=false;}; }, []);

  async function change(value: boolean) {
    if(busy)return;setBusy(true);
    setEnterSends(value);
    setError("");
    if (!(await saveEnterSends(value))) { setEnterSends(!value); setError("Your choice could not be saved on this phone."); }
    setBusy(false);
  }

  return (
    <SafeAreaView style={s.screen}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12} style={s.back}><Text style={s.backText}>‹ Back</Text></Pressable>
      <Text style={s.title}>Messaging</Text>
      <Text style={s.subtitle}>How typing works in your chats.</Text>
      <View style={s.card}>
        <View style={s.row}>
          <View style={s.copy}>
            <Text style={s.label}>Enter key sends</Text>
            <Text style={s.hint}>{enterSends ? "The Enter key on the keyboard sends the message." : "The Enter key starts a new line. Use the send button to send."}</Text>
          </View>
          <Switch disabled={busy} accessibilityLabel="Enter key sends" value={enterSends} onValueChange={(value) => void change(value)} />
        </View>
      </View>
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6FA", padding: 20 },
  back: { minHeight: 44, justifyContent: "center" },
  backText: { color: "#5B4CFF", fontSize: 17, fontWeight: "600" },
  title: { fontSize: 28, fontWeight: "800", color: "#111827", marginTop: 4 },
  subtitle: { color: "#6B7280", marginTop: 4, marginBottom: 18, fontSize: 15 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1 },
  label: { fontSize: 16, fontWeight: "700", color: "#111827" },
  hint: { marginTop: 4, fontSize: 13, color: "#6B7280" },
  error: { color: "#B3261E", marginTop: 12 }
});

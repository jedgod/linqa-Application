import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, LinqaSendTabBar, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();
type Settings = Awaited<ReturnType<LinqaSendService["getSettings"]>>;
type Entry = { label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; route: string };

const ENTRIES: Entry[] = [
  { label: "Dashboard", hint: "Totals and recent activity", icon: "stats-chart-outline", route: "/linqasend/dashboard" },
  { label: "Transaction History", hint: "Sent and received transfers", icon: "receipt-outline", route: "/linqasend/history" },
  { label: "Transfer Limits", hint: "What you can still send", icon: "speedometer-outline", route: "/linqasend/transfer-limits" },
  { label: "Cards on File", hint: "Payment methods", icon: "card-outline", route: "/linqasend/payment-methods" },
  { label: "Global Contacts", hint: "Recipients outside Linqa", icon: "people-outline", route: "/linqasend/global-contacts" },
  { label: "Requests", hint: "Money requests to and from you", icon: "mail-unread-outline", route: "/linqasend/requests" },
  { label: "Region", hint: "Country of residence", icon: "earth-outline", route: "/linqasend/jurisdiction" }
];

/** More: shortcuts to every LinqaSend area, plus notification and scam-warning preferences. */
export default function LinqaSendMore() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");

  useFocusEffect(useCallback(() => {
    let active = true;
    client.getSettings().then((value) => { if (active) setSettings(value); }, (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ") : "Unable to load settings"); });
    return () => { active = false; };
  }, [client]));

  // Optimistic: flip the switch, send the change, and put it back if the server refuses.
  async function change(patch: Partial<Settings>, request: Parameters<LinqaSendService["updateSettings"]>[0]) {
    if (!settings) return;
    const before = settings;
    setSettings({ ...settings, ...patch });
    setError("");
    try { await client.updateSettings(request); }
    catch (cause) { setSettings(before); setError(cause instanceof Error ? cause.message.replace(/_/g, " ") : "Unable to save settings"); }
  }

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <Text accessibilityRole="header" style={s.title}>More</Text>
      <ScrollView contentContainerStyle={s.content}>
        {ENTRIES.map((entry) => (
          <Pressable key={entry.route} accessibilityRole="button" accessibilityLabel={entry.label} style={s.entry} onPress={() => router.push(entry.route as never)}>
            <View style={s.icon}><Ionicons name={entry.icon} size={22} color={send.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.entryLabel}>{entry.label}</Text>
              <Text style={s.entryHint}>{entry.hint}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={send.faint} />
          </Pressable>
        ))}

        <Text style={s.section}>Preferences</Text>
        {!settings && !error ? <ActivityIndicator color={send.primary} style={{ marginTop: 16 }} /> : null}
        {settings ? (
          <View style={s.card}>
            <View style={s.setting}>
              <Text style={s.settingText}>Transfer notifications</Text>
              <Switch value={settings.transfer_notifications} trackColor={{ true: send.primary, false: send.border }} thumbColor="#FFFFFF" onValueChange={(v) => void change({ transfer_notifications: v }, { transferNotifications: v })} />
            </View>
            <View style={s.setting}>
              <Text style={s.settingText}>Request notifications</Text>
              <Switch value={settings.request_notifications} trackColor={{ true: send.primary, false: send.border }} thumbColor="#FFFFFF" onValueChange={(v) => void change({ request_notifications: v }, { requestNotifications: v })} />
            </View>
            <View style={[s.setting, { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={s.settingText}>Enhanced scam warnings</Text>
                <Text style={s.entryHint}>Extra checks before sending to new recipients</Text>
              </View>
              <Switch value={settings.scam_warning_level === "ENHANCED"} trackColor={{ true: send.primary, false: send.border }} thumbColor="#FFFFFF" onValueChange={(v) => { const level = v ? "ENHANCED" : "STANDARD"; void change({ scam_warning_level: level }, { scamWarningLevel: level }); }} />
            </View>
          </View>
        ) : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>
      <LinqaSendTabBar active="more" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  entry: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: send.border },
  icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: send.primarySoft, alignItems: "center", justifyContent: "center" },
  entryLabel: { color: send.text, fontFamily: fonts.semibold, fontSize: 16 },
  entryHint: { color: send.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  section: { color: send.text, fontFamily: fonts.extrabold, fontSize: 16, marginTop: 26, marginBottom: 6 },
  card: { backgroundColor: send.surface, borderRadius: 16, paddingHorizontal: 16 },
  setting: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: send.border },
  settingText: { color: send.text, fontFamily: fonts.semibold, fontSize: 15 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14, marginTop: 14 }
});

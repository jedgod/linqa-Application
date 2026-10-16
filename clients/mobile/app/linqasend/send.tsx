import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { LinqaSendService } from "../../services/linqasend.service";
import { getApiBaseUrl } from "../../config/api";
import { accessTokenProvider } from "../../services/session";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, LinqaSendTabBar, send } from "../../components/linqasend/ui";
import { fonts } from "../../theme/tokens";

type Option = { label: string; hint: string; icon: keyof typeof Ionicons.glyphMap; route: string };
const OPTIONS: Option[] = [
  { label: "To Linqa User", hint: "Find a verified Linqa account by phone or email", icon: "people-outline", route: "/linqasend/recipients" },
  { label: "Outside Linqa", hint: "Bank, card or mobile-money payout", icon: "business-outline", route: "/linqasend/add-recipient" },
  { label: "Global Contacts", hint: "Recipients you saved before", icon: "person-outline", route: "/linqasend/global-contacts" },
  { label: "Recent Recipients", hint: "People you sent to lately", icon: "time-outline", route: "/linqasend/recipients" }
];

/** Send: who the money goes to. Each choice leads to picking a recipient, then the amount. */
export default function LinqaSendMode() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [resume, setResume] = useState<Awaited<ReturnType<LinqaSendService["pendingPaymentReview"]>>>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    client.pendingPaymentReview().then(value => { if (active) setResume(value); }).catch(() => {});
    return () => { active = false; };
  }, [client]));
  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <Text accessibilityRole="header" style={s.title}>Send Money</Text>
      <ScrollView contentContainerStyle={s.content}>
        {resume ? <Pressable accessibilityRole="button" style={s.card} onPress={() => router.push({ pathname: "/linqasend/review", params: resume })}><Text style={s.cardTitle}>Resume pending payment — check its status</Text></Pressable> : null}
        <Text style={s.copy}>Choose who you want to send to.</Text>
        {OPTIONS.map((option) => (
          <Pressable key={option.label} accessibilityRole="button" accessibilityLabel={option.label} style={s.card} onPress={() => router.push(option.route as never)}>
            <View style={s.icon}><Ionicons name={option.icon} size={24} color={send.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{option.label}</Text>
              <Text style={s.cardHint}>{option.hint}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={send.faint} />
          </Pressable>
        ))}
      </ScrollView>
      <LinqaSendTabBar active="send" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  copy: { color: send.muted, fontFamily: fonts.regular, fontSize: 15, marginBottom: 16 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: send.surface, borderRadius: 18, padding: 16, marginBottom: 12 },
  icon: { width: 50, height: 50, borderRadius: 16, backgroundColor: send.primarySoft, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: send.text, fontFamily: fonts.bold, fontSize: 16 },
  cardHint: { color: send.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 }
});

import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import type { CountryLinqaCatalog, CountryLinqaPreferences } from "../../services/countrylinqa.service";
import { reachSummaries } from "../../services/countrylinqa-settings";
import { flagOf } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

/** 5.1 CountryLinqa Settings Home: your verified country, and where you discover and who can reach you. */
export default function CountryLinqaSettingsHome() {
  const router = useRouter();
  const client = useCountryClient();
  const [prefs, setPrefs] = useState<CountryLinqaPreferences | null>(null);
  const [catalog, setCatalog] = useState<CountryLinqaCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    Promise.all([client.preferences(), client.catalog()]).then(
      ([p, c]) => { if (active) { setPrefs(p); setCatalog(c); } },
      (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load settings"); }
    );
    return () => { active = false; };
  }, [client, reload]));

  const country = catalog?.countries.find((c) => c.code === prefs?.verifiedCountryCode);
  const verified = prefs?.verificationState === "VERIFIED";
  const sums = prefs && catalog ? reachSummaries(prefs, catalog) : null;
  const rows = sums ? [
    { icon: "compass-outline" as const, title: "Countries I Discover", value: sums.discover },
    { icon: "eye-outline" as const, title: "Countries That Can Discover Me", value: sums.discoverMe },
    { icon: "chatbubble-ellipses-outline" as const, title: "Countries That Can Chat Me", value: sums.chatMe }
  ] : [];

  return (
    <WorldScreen>
      <WorldHeader title="CountryLinqa Settings" back />
      <ScrollView contentContainerStyle={s.content}>
        {error ? <Empty icon="cloud-offline-outline" title="Can not load settings" text={error} action={{ label: "Try again", onPress: () => setReload((n) => n + 1) }} /> : null}
        {!prefs && !error ? <Spinner /> : null}
        {prefs && catalog ? (
          <>
            <Text style={s.section}>Your Country</Text>
            <View style={s.country}>
              <Text style={s.flag}>{prefs.verifiedCountryCode ? flagOf(prefs.verifiedCountryCode) : "🌐"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.countryName}>{country?.name ?? "Country not confirmed"}</Text>
                <View style={[s.badge, !verified && { backgroundColor: "#FFF6E5" }]}>
                  <Ionicons name={verified ? "checkmark-circle" : "alert-circle-outline"} size={14} color={verified ? "#12805C" : "#B54708"} />
                  <Text style={[s.badgeText, { color: verified ? "#12805C" : "#B54708" }]}>{verified ? "Verified" : "Not verified"}</Text>
                </View>
              </View>
              {!verified ? <Pressable accessibilityRole="button" style={s.confirm} onPress={() => router.push("/onboarding/resolve")}><Text style={s.confirmText}>Confirm</Text></Pressable> : null}
            </View>

            <Text style={s.section}>Discovery & Access</Text>
            {rows.map((row) => (
              <Pressable key={row.title} accessibilityRole="button" accessibilityLabel={`${row.title}, ${row.value}`} style={s.row} onPress={() => router.push("/countrylinqa/manage-countries")}>
                <View style={s.icon}><Ionicons name={row.icon} size={22} color={world.purple} /></View>
                <View style={{ flex: 1 }}><Text style={s.rowTitle}>{row.title}</Text><Text style={s.rowValue}>{row.value}</Text></View>
                <Ionicons name="chevron-forward" size={18} color={world.faint} />
              </Pressable>
            ))}

            <Text style={s.section}>More</Text>
            {[
              { icon: "options-outline" as const, title: "More Settings", route: "/countrylinqa/more-settings" },
              { icon: "ribbon-outline" as const, title: "Plan & Subscription", route: "/countrylinqa/plan" },
              { icon: "person-circle-outline" as const, title: "My discovery profile", route: "/countrylinqa/discovery-profile" },
              { icon: "bookmark-outline" as const, title: "Saved searches", route: "/countrylinqa/saved-searches" }
            ].map((r) => (
              <Pressable key={r.title} accessibilityRole="button" style={s.plain} onPress={() => router.push(r.route as never)}>
                <Ionicons name={r.icon} size={22} color={world.purple} /><Text style={s.plainText}>{r.title}</Text><Ionicons name="chevron-forward" size={18} color={world.faint} />
              </Pressable>
            ))}
            <Text style={s.fine}>Reach and visibility never change your verified country identity.</Text>
          </>
        ) : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 30 },
  section: { color: world.purple, fontFamily: fonts.bold, fontSize: 16, marginTop: 18, marginBottom: 10 },
  country: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1, borderColor: world.border, padding: 14 },
  flag: { fontSize: 44 },
  countryName: { color: world.text, fontFamily: fonts.bold, fontSize: 18 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: "#E7F6EF", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 12 },
  confirm: { minHeight: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: world.soft, alignItems: "center", justifyContent: "center" },
  confirmText: { color: world.purple, fontFamily: fonts.bold, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1, borderColor: world.border, padding: 14, marginBottom: 10, minHeight: 72 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: world.soft, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: world.purple, fontFamily: fonts.semibold, fontSize: 15 },
  rowValue: { color: world.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 3 },
  plain: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 54, borderBottomWidth: 1, borderBottomColor: world.border },
  plainText: { flex: 1, color: world.text, fontFamily: fonts.medium, fontSize: 15 },
  fine: { color: world.faint, fontFamily: fonts.regular, fontSize: 12, textAlign: "center", marginTop: 18 }
});

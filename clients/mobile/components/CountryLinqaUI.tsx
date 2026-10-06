import { Ionicons } from "@expo/vector-icons";
import { useMemo, useRef, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAccounts } from "../account/AccountContext";
import { CountryLinqaService, type CountryCollection, type CountrySearch } from "../services/countrylinqa.service";
import { accessTokenProvider } from "../services/session";
import { getApiBaseUrl } from "../config/api";

export function useCountryClient() {
  const { active } = useAccounts();
  const currentAccount = useRef(active?.userId);
  currentAccount.current = active?.userId;
  return useMemo(() => {
    const owner = active?.userId;
    return new CountryLinqaService(getApiBaseUrl(), async () => {
      if (!owner || currentAccount.current !== owner) throw new Error("Account changed. Reopen CountryLinqa to continue.");
      const token = await accessTokenProvider.getAccessToken();
      if (currentAccount.current !== owner) throw new Error("Account changed. Reopen CountryLinqa to continue.");
      return token;
    }, () => !!owner && currentAccount.current === owner);
  }, [active?.userId]);
}
export const countryTabs: Array<{ kind: CountryCollection; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { kind: "feed", label: "World", icon: "globe-outline" }, { kind: "people", label: "People", icon: "people-outline" },
  { kind: "events", label: "Events", icon: "calendar-outline" }, { kind: "businesses", label: "Businesses", icon: "storefront-outline" },
  { kind: "communities", label: "Communities", icon: "people-circle-outline" }
];
export function CountryPage({ title, children, actions, tab }: { title: string; children: ReactNode; actions?: ReactNode; tab?: CountryCollection }) {
  const router = useRouter();
  return <SafeAreaView style={countryStyles.screen}>
    <View style={countryStyles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace("/countrylinqa/world")} style={countryStyles.iconButton}><Ionicons name="chevron-back" size={23} color="#6045E8" /></Pressable>
      <Text style={countryStyles.headerTitle}>{title}</Text>{actions}
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={countryStyles.content}>{children}</ScrollView>
    {tab && <View style={countryStyles.tabs}>{countryTabs.map(item => <Pressable key={item.kind} accessibilityRole="tab" accessibilityState={{ selected: tab === item.kind }} onPress={() => router.replace({ pathname: "/countrylinqa/list", params: { kind: item.kind } })} style={countryStyles.tab}>
      <Ionicons name={item.icon} size={21} color={tab === item.kind ? "#6045E8" : "#667085"} /><Text style={[countryStyles.tabText, tab === item.kind && { color: "#6045E8" }]}>{item.label}</Text>
    </Pressable>)}</View>}
  </SafeAreaView>;
}
export function CountryButton({ label, onPress, disabled, secondary }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[countryStyles.button, secondary && countryStyles.secondaryButton, disabled && { opacity: .45 }]}><Text style={[countryStyles.buttonText, secondary && { color: "#6045E8" }]}>{label}</Text></Pressable>;
}
export function CountryInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <View><Text style={countryStyles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#667085" style={countryStyles.input} /></View>;
}
export function CountryError({ error, retry }: { error: string | null; retry?: () => void }) {
  return error ? <View accessibilityLiveRegion="polite" style={countryStyles.error}><Text style={{ color: "#B42318" }}>{error.replace(/_/g, " ")}</Text>{retry && <CountryButton secondary label="Try again" onPress={retry} />}</View> : null;
}
export function CountryLoading() { return <ActivityIndicator accessibilityLabel="Loading CountryLinqa" style={{ padding: 30 }} color="#6045E8" />; }
export function CountryPicker({ label, value, options, onChange }: { label: string; value: string; options: Array<{ code: string; name: string }>; onChange: (value: string) => void }) {
  return <View><Text style={countryStyles.label}>{label}</Text><ScrollView style={countryStyles.picker} nestedScrollEnabled><Pressable style={countryStyles.choice} onPress={() => onChange("")}><Text style={countryStyles.copy}>{!value ? "✓ " : ""}Any in my discovery scope</Text></Pressable>{options.map(item => <Pressable key={item.code} accessibilityRole="radio" accessibilityState={{ checked: value === item.code }} style={countryStyles.choice} onPress={() => onChange(item.code)}><Text style={countryStyles.copy}>{value === item.code ? "✓ " : ""}{item.name}</Text></Pressable>)}</ScrollView></View>;
}
export function parseCountryFilters(input?: string): CountrySearch {
  try {
    const parsed = JSON.parse(input ?? "{}");
    const output: CountrySearch = {};
    for (const key of ["q", "country", "region", "language"] as const) if (typeof parsed?.[key] === "string") output[key] = parsed[key];
    if (typeof parsed?.verifiedOnly === "boolean") output.verifiedOnly = parsed.verifiedOnly;
    return output;
  } catch { return {}; }
}
export const countryStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F8FC" }, header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 62, backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#EAECF0" },
  headerTitle: { flex: 1, fontSize: 19, fontWeight: "800", color: "#6045E8" }, iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  content: { padding: 18, paddingBottom: 36, gap: 14 }, title: { color: "#101828", fontSize: 24, fontWeight: "800" }, label: { color: "#344054", fontSize: 13, fontWeight: "700", marginBottom: 8 },
  copy: { color: "#667085", fontSize: 14, lineHeight: 21 }, card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E4E7EC", padding: 18, borderRadius: 18, gap: 10 }, cardTitle: { color: "#101828", fontSize: 17, fontWeight: "800" },
  button: { minHeight: 48, padding: 13, borderRadius: 13, backgroundColor: "#6045E8", alignItems: "center", justifyContent: "center" }, secondaryButton: { backgroundColor: "#EEE9FF" }, buttonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  input: { minHeight: 48, borderRadius: 13, paddingHorizontal: 13, borderWidth: 1, borderColor: "#D0D5DD", backgroundColor: "#FFFFFF", color: "#101828" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, chip: { paddingVertical: 10, paddingHorizontal: 13, borderRadius: 99, backgroundColor: "#EEE9FF" },
  error: { backgroundColor: "#FEF3F2", padding: 14, borderRadius: 13, gap: 10 }, picker: { maxHeight: 185, backgroundColor: "#FFFFFF", borderRadius: 13, borderWidth: 1, borderColor: "#E4E7EC" }, choice: { padding: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#EAECF0" },
  tabs: { flexDirection: "row", backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#EAECF0", paddingVertical: 10 }, tab: { flex: 1, alignItems: "center", gap: 4, minHeight: 44 }, tabText: { color: "#667085", fontSize: 10, fontWeight: "600" }
});

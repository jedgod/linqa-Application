import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, LinqaSendStatusBar, countryName, deliveryLabel, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService, type LinqaSendRecipient } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();
type Tab = "GLOBAL" | "LINQA";

export default function LinqaSendRecipients() {
  const router = useRouter();
  const { country: countryFilter } = useLocalSearchParams<{ country?: string }>();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [items, setItems] = useState<LinqaSendRecipient[] | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("GLOBAL");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await client.listRecipients()).items);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "Unable to load recipients");
    }
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const isLinqa = (r: LinqaSendRecipient) => r.recipientType === "LINQA_USER";
  const needle = query.trim().toLowerCase();
  const matches = (r: LinqaSendRecipient) =>
    (!countryFilter || r.country.toUpperCase() === countryFilter.toUpperCase()) && (!needle || `${r.displayName} ${countryName(r.country)} ${r.country} ${r.preferredCurrency}`.toLowerCase().includes(needle));
  const all = items ?? [];
  const visible = all.filter((r) => (tab === "LINQA" ? isLinqa(r) : !isLinqa(r))).filter(matches);
  const otherTabMatches = all.filter((r) => (tab === "LINQA" ? !isLinqa(r) : isLinqa(r))).filter(matches).length;
  // A typed phone or email that matches nobody can be looked up as a Linqa user.
  const canLookUp = needle.length >= 3 && all.every((r) => !matches(r)) && /[@\d]/.test(needle);

  async function lookUp() {
    setBusy(true);
    setError(null);
    try {
      await client.addRecipient(query.trim());
      setQuery("");
      setTab("LINQA");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recipient was not found");
    } finally {
      setBusy(false);
    }
  }

  function select(recipient: LinqaSendRecipient) {
    router.push({
      pathname: "/linqasend/amount",
      params: { recipientId: recipient.id, recipientName: recipient.displayName, recipientCountry: recipient.country, recipientCurrency: recipient.preferredCurrency, ...(recipient.recipientType ? { recipientType: recipient.recipientType } : {}) }
    });
  }

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>{countryFilter ? countryName(countryFilter) : "Select Recipient"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Add a recipient" style={s.headerButton} onPress={() => router.push("/linqasend/add-recipient")}>
          <Ionicons name="add" size={30} color={send.primary} />
        </Pressable>
      </View>

      <View style={s.search}>
        <Ionicons name="search-outline" size={20} color={send.faint} />
        <TextInput
          accessibilityLabel="Search recipients"
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, phone or email"
          placeholderTextColor={send.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={s.searchInput}
        />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery("")}><Ionicons name="close-circle" size={20} color={send.faint} /></Pressable> : null}
      </View>

      <View style={s.tabs} accessibilityRole="tablist">
        {([["GLOBAL", "Global Contacts"], ["LINQA", "Linqa Users"]] as const).map(([key, label]) => (
          <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} style={[s.tab, tab === key && s.tabActive]} onPress={() => setTab(key)}>
            <Text style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={s.errorBox}>
            <Text style={s.error}>{error.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={s.link}>Try again</Text></Pressable>
          </View>
        ) : null}

        {items === null ? <ActivityIndicator color={send.primary} style={{ marginTop: 40 }} /> : null}

        {visible.map((recipient) => (
          <Pressable key={recipient.id} accessibilityRole="button" accessibilityLabel={`Send to ${recipient.displayName}`} style={s.row} onPress={() => select(recipient)}>
            <Avatar name={recipient.displayName} size={56} />
            <View style={s.rowText}>
              <Text style={s.name} numberOfLines={1}>{recipient.displayName}</Text>
              <Text style={s.meta} numberOfLines={1}>{countryName(recipient.country)} • {deliveryLabel(recipient.recipientType)}</Text>
              <Text style={s.metaSmall}>Receives in {recipient.preferredCurrency}</Text>
            </View>
            {recipient.isFavorite ? <Ionicons name="star" size={22} color={send.star} accessibilityLabel="Favorite" /> : null}
          </Pressable>
        ))}

        {items !== null && visible.length === 0 && !error ? (
          <View style={s.empty}>
            <Ionicons name="people-outline" size={40} color={send.faint} />
            <Text style={s.emptyTitle}>{needle ? "No matches" : tab === "LINQA" ? "No Linqa users yet" : "No global contacts yet"}</Text>
            <Text style={s.emptyText}>
              {needle && otherTabMatches > 0
                ? `${otherTabMatches} match${otherTabMatches > 1 ? "es" : ""} in ${tab === "LINQA" ? "Global Contacts" : "Linqa Users"}.`
                : tab === "LINQA" ? "Search a verified phone number or email to add someone on Linqa." : "Add someone who receives money in a bank account or mobile money wallet."}
            </Text>
            {canLookUp ? (
              <Pressable accessibilityRole="button" disabled={busy} style={s.cta} onPress={lookUp}>
                <Text style={s.ctaText}>{busy ? "Looking up…" : `Find "${query.trim()}" on Linqa`}</Text>
              </Pressable>
            ) : null}
            {!needle && tab === "GLOBAL" ? (
              <Pressable accessibilityRole="button" style={s.cta} onPress={() => router.push("/linqasend/add-recipient")}>
                <Text style={s.ctaText}>Add a contact</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 16 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, height: 50, borderRadius: 14, backgroundColor: send.surface, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: send.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  tabs: { flexDirection: "row", marginTop: 14, borderBottomWidth: 1, borderBottomColor: send.border },
  tab: { flex: 1, alignItems: "center", paddingVertical: 14, borderBottomWidth: 2.5, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: send.primary },
  tabText: { color: send.muted, fontFamily: fonts.semibold, fontSize: 15 },
  tabTextActive: { color: send.primary, fontFamily: fonts.bold },
  list: { paddingHorizontal: 20, paddingBottom: 30 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: send.border },
  rowText: { flex: 1 },
  name: { color: send.text, fontFamily: fonts.bold, fontSize: 16 },
  meta: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 3 },
  metaSmall: { color: send.faint, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  empty: { alignItems: "center", paddingTop: 50, paddingHorizontal: 20, gap: 8 },
  emptyTitle: { color: send.text, fontFamily: fonts.bold, fontSize: 16, marginTop: 6 },
  emptyText: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  cta: { marginTop: 10, height: 48, borderRadius: 14, backgroundColor: send.primary, paddingHorizontal: 22, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 15 },
  errorBox: { backgroundColor: "#FEF3F2", borderRadius: 14, padding: 14, gap: 8, marginTop: 14 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14 },
  link: { color: send.primary, fontFamily: fonts.bold, fontSize: 14 }
});

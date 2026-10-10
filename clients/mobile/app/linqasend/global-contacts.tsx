import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinqaSendStatusBar, countryName, currencyFlag, send } from "../../components/linqasend/ui";
import { getApiBaseUrl } from "../../config/api";
import { LinqaSendService, type LinqaSendRecipient } from "../../services/linqasend.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const API = getApiBaseUrl();

/** Country flag from a region code ("GH" -> flag). */
function regionFlag(code: string): string {
  return /^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : currencyFlag("");
}

type Group = { code: string; name: string; contacts: LinqaSendRecipient[] };

/** Contacts who receive money outside Linqa, grouped by country. */
export default function LinqaSendGlobalContacts() {
  const router = useRouter();
  const client = useMemo(() => new LinqaSendService(API, () => accessTokenProvider.getAccessToken()), []);
  const [items, setItems] = useState<LinqaSendRecipient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await client.listRecipients()).items.filter((r) => r.recipientType !== "LINQA_USER"));
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : "Unable to load your contacts");
    }
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const groups: Group[] = useMemo(() => {
    const byCountry = new Map<string, LinqaSendRecipient[]>();
    for (const recipient of items ?? []) {
      const code = recipient.country.toUpperCase();
      byCountry.set(code, [...(byCountry.get(code) ?? []), recipient]);
    }
    return [...byCountry.entries()]
      .map(([code, contacts]) => ({ code, name: countryName(code), contacts }))
      .sort((a, b) => b.contacts.length - a.contacts.length || a.name.localeCompare(b.name));
  }, [items]);

  const needle = query.trim().toLowerCase();
  const visible = groups
    .filter((group) => !country || group.code === country)
    .map((group) => {
      if (!needle || group.name.toLowerCase().includes(needle) || group.code.toLowerCase() === needle) return group;
      return { ...group, contacts: group.contacts.filter((c) => c.displayName.toLowerCase().includes(needle)) };
    })
    .filter((group) => group.contacts.length > 0);

  return (
    <SafeAreaView style={s.screen}>
      <LinqaSendStatusBar />
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={s.headerButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={send.text} />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>Global Contacts</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Add a contact" style={s.headerButton} onPress={() => router.push("/linqasend/add-recipient")}>
          <Ionicons name="add" size={30} color={send.primary} />
        </Pressable>
      </View>

      <View style={s.search}>
        <Ionicons name="search-outline" size={20} color={send.faint} />
        <TextInput accessibilityLabel="Search contacts" value={query} onChangeText={setQuery} placeholder="Search contacts" placeholderTextColor={send.faint} autoCorrect={false} style={s.searchInput} />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery("")}><Ionicons name="close-circle" size={20} color={send.faint} /></Pressable> : null}
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Filter by country" style={s.filter} onPress={() => setPickerOpen(true)} disabled={groups.length === 0}>
        <Text style={s.filterText}>{country ? countryName(country) : "All Countries"}</Text>
        <Ionicons name="chevron-down" size={18} color={send.text} />
      </Pressable>

      <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={s.errorBox}>
            <Text style={s.error}>{error.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={s.link}>Try again</Text></Pressable>
          </View>
        ) : null}
        {items === null ? <ActivityIndicator color={send.primary} style={{ marginTop: 40 }} /> : null}

        {visible.map((group) => (
          <Pressable
            key={group.code}
            accessibilityRole="button"
            accessibilityLabel={`${group.name}, ${group.contacts.length} contact${group.contacts.length === 1 ? "" : "s"}`}
            style={s.row}
            onPress={() => router.push({ pathname: "/linqasend/recipients", params: { country: group.code } })}
          >
            <Text style={s.flag}>{regionFlag(group.code)}</Text>
            <View style={s.rowText}>
              <Text style={s.country}>{group.name}</Text>
              <Text style={s.count}>{group.contacts.length} contact{group.contacts.length === 1 ? "" : "s"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={send.muted} />
          </Pressable>
        ))}

        {items !== null && visible.length === 0 && !error ? (
          <View style={s.empty}>
            <Ionicons name="earth-outline" size={44} color={send.faint} />
            <Text style={s.emptyTitle}>{needle || country ? "No matching contacts" : "No global contacts yet"}</Text>
            <Text style={s.emptyText}>{needle || country ? "Try a different search or country." : "Add someone who receives money outside Linqa, such as in a bank account or mobile money wallet."}</Text>
          </View>
        ) : null}

        <Pressable accessibilityRole="button" style={s.add} onPress={() => router.push("/linqasend/add-recipient")}>
          <Ionicons name="add" size={26} color={send.primary} />
          <Text style={s.addText}>Add New Contact</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setPickerOpen(false)} accessibilityLabel="Close country filter" />
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>Filter by country</Text>
          <ScrollView>
            {[{ code: null as string | null, name: "All Countries" }, ...groups].map((option) => {
              const selected = (option.code ?? null) === country;
              return (
                <Pressable key={option.code ?? "all"} accessibilityRole="radio" accessibilityState={{ checked: selected }} style={s.option} onPress={() => { setCountry(option.code); setPickerOpen(false); }}>
                  <Text style={s.optionText}>{option.code ? `${regionFlag(option.code)}  ${option.name}` : option.name}</Text>
                  {selected ? <Ionicons name="checkmark" size={22} color={send.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: send.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, height: 50, borderRadius: 14, backgroundColor: send.surface, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: send.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  filter: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 20, marginTop: 18, marginBottom: 6, alignSelf: "flex-start", minHeight: 36 },
  filterText: { color: send.text, fontFamily: fonts.bold, fontSize: 16 },
  list: { paddingHorizontal: 20, paddingBottom: 30 },
  row: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 16, borderTopWidth: 1, borderTopColor: send.border },
  flag: { fontSize: 34, width: 52, textAlign: "center" },
  rowText: { flex: 1 },
  country: { color: send.text, fontFamily: fonts.bold, fontSize: 17 },
  count: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, marginTop: 3 },
  add: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 20, borderTopWidth: 1, borderTopColor: send.border },
  addText: { color: send.primary, fontFamily: fonts.bold, fontSize: 17 },
  empty: { alignItems: "center", paddingTop: 44, paddingBottom: 20, paddingHorizontal: 16, gap: 8 },
  emptyTitle: { color: send.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 6 },
  emptyText: { color: send.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  errorBox: { backgroundColor: "#FEF3F2", borderRadius: 14, padding: 14, gap: 8, marginTop: 10 },
  error: { color: send.danger, fontFamily: fonts.medium, fontSize: 14 },
  link: { color: send.primary, fontFamily: fonts.bold, fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { maxHeight: "60%", backgroundColor: send.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24 },
  sheetTitle: { color: send.text, fontFamily: fonts.extrabold, fontSize: 18, marginBottom: 8 },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, borderBottomWidth: 1, borderBottomColor: send.border },
  optionText: { color: send.text, fontFamily: fonts.semibold, fontSize: 16 }
});

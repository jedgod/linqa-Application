import { useCallback, useEffect, useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MobileHubService, type HubContact } from "../services/mobile-hub.service";
import { accessTokenProvider } from "../services/session";
import { getApiBaseUrl } from "../config/api";

const API = getApiBaseUrl();
const AVATAR_COLORS = ["#E9E7FF", "#DCF7EF", "#FFE8D8", "#E0F2FE", "#FCE7F3", "#FEF3C7"];

export default function ConnectionsScreen() {
  const router = useRouter();
  const service = useMemo(
    () => new MobileHubService(API, () => accessTokenProvider.getAccessToken()),
    []
  );
  const [contacts, setContacts] = useState<HubContact[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingContactId, setOpeningContactId] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const hub = await service.loadHub();
      setContacts(hub.contacts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load your connections.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleContacts = contacts.filter((contact) =>
    contact.displayName.toLowerCase().includes(query.trim().toLowerCase())
  );

  async function startConversation(contact: HubContact) {
    setOpeningContactId(contact.id);
    setError(null);
    try {
      await service.createConversation(contact.id);
      router.push("/(tabs)/chats");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start a conversation.");
    } finally {
      setOpeningContactId(null);
    }
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" style={s.back}>
          <Ionicons name="chevron-back" size={22} color="#171A35" />
        </Pressable>
        <View style={s.headerCopy}>
          <Text style={s.eyebrow}>STAY IN TOUCH</Text>
          <Text style={s.title}>Connections</Text>
        </View>
        <View style={s.countBadge}>
          <Text style={s.countText}>{contacts.length}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor="#5B4CFF" />}
      >
        <Text style={s.subtitle}>Your people on Linqa, ready to message.</Text>
        <View style={s.search}>
          <Ionicons name="search" size={19} color="#747A91" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search connections"
            placeholderTextColor="#9297AA"
            style={s.searchInput}
            accessibilityLabel="Search connections"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color="#9297AA" />
            </Pressable>
          ) : null}
        </View>

        {error ? (
          <View style={s.error}>
            <Ionicons name="cloud-offline-outline" size={19} color="#B42318" />
            <Text style={s.errorText}>{error}</Text>
            <Pressable onPress={() => void load()} accessibilityRole="button">
              <Text style={s.retry}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator color="#5B4CFF" style={s.loader} />
        ) : visibleContacts.length ? (
          <View style={s.list}>
            {visibleContacts.map((contact, index) => (
              <Pressable
                key={contact.id}
                style={[s.contact, index > 0 && s.divided]}
                onPress={() => void startConversation(contact)}
                accessibilityRole="button"
                accessibilityLabel={`Message ${contact.displayName}`}
                disabled={openingContactId !== null}
              >
                <View style={[s.avatar, { backgroundColor: AVATAR_COLORS[contact.colorHue % AVATAR_COLORS.length] }]}>
                  <Text style={s.initials}>{contact.initials}</Text>
                  <View style={[s.presence, contact.online && s.presenceOnline]} />
                </View>
                <View style={s.contactCopy}>
                  <Text style={s.name}>{contact.displayName}</Text>
                  <Text style={s.status} numberOfLines={1}>
                    {contact.statusBody || (contact.online ? "Online now" : "On Linqa")}
                  </Text>
                </View>
                {openingContactId === contact.id ? (
                  <ActivityIndicator color="#5B4CFF" />
                ) : (
                  <Ionicons name="chatbubble-ellipses-outline" size={21} color="#5B4CFF" />
                )}
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Ionicons name={query ? "search-outline" : "people-outline"} size={30} color="#5B4CFF" />
            </View>
            <Text style={s.emptyTitle}>{query ? "No matching connections" : "No connections yet"}</Text>
            <Text style={s.emptyText}>
              {query
                ? "Try another name."
                : "People you can message on Linqa will appear here."}
            </Text>
            {!query ? (
              <Pressable style={s.discoverButton} onPress={() => router.push("/countrylinqa/world")}>
                <Text style={s.discoverText}>Discover your community</Text>
                <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F8FC" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14, backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#E9EAF2" },
  back: { width: 40, height: 40, borderRadius: 14, backgroundColor: "#F2F3F8", alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, marginLeft: 12 },
  eyebrow: { color: "#5B4CFF", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  title: { color: "#151831", fontSize: 21, fontWeight: "900", marginTop: 2 },
  countBadge: { minWidth: 32, height: 32, borderRadius: 16, backgroundColor: "#EFEEFF", alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  countText: { color: "#5B4CFF", fontSize: 12, fontWeight: "900" },
  content: { padding: 18, paddingBottom: 40 },
  subtitle: { color: "#71778D", fontSize: 13, lineHeight: 19, marginBottom: 14 },
  search: { minHeight: 50, paddingHorizontal: 14, borderRadius: 15, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7F0", flexDirection: "row", alignItems: "center", gap: 10 },
  searchInput: { flex: 1, color: "#171A35", fontSize: 14 },
  error: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, marginTop: 14, borderRadius: 12, backgroundColor: "#FEF3F2" },
  errorText: { flex: 1, color: "#B42318", fontSize: 12, lineHeight: 17 },
  retry: { color: "#B42318", fontSize: 12, fontWeight: "800" },
  loader: { marginTop: 70 },
  list: { marginTop: 18, paddingHorizontal: 14, borderRadius: 18, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E9EAF2" },
  contact: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: "#F0F1F6" },
  avatar: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center", position: "relative" },
  initials: { color: "#2D3150", fontSize: 14, fontWeight: "900" },
  presence: { position: "absolute", width: 11, height: 11, borderRadius: 6, right: -1, bottom: -1, borderWidth: 2, borderColor: "#FFFFFF", backgroundColor: "#C3C7D3" },
  presenceOnline: { backgroundColor: "#20C77A" },
  contactCopy: { flex: 1 },
  name: { color: "#171A35", fontSize: 14, fontWeight: "800" },
  status: { color: "#777D92", fontSize: 11, marginTop: 4 },
  empty: { alignItems: "center", paddingTop: 72, paddingHorizontal: 24 },
  emptyIcon: { width: 66, height: 66, borderRadius: 22, backgroundColor: "#EFEEFF", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#20233D", fontSize: 17, fontWeight: "900", marginTop: 16 },
  emptyText: { color: "#777D92", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 6 },
  discoverButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 15, marginTop: 18, borderRadius: 14, backgroundColor: "#5B4CFF" },
  discoverText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }
});

import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList, Pressable, SafeAreaView, StyleSheet,
  Text, TextInput, View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { CallsService, type CallHistoryItem } from "../../services/calls.service";
import { accessTokenProvider } from "../../services/session";
import { QuickCreateSheet } from "../../components/QuickCreateSheet";
import { createActionsForPath, type CreateActionKey } from "../../navigation/information-architecture";

const FILTERS = ["All", "Missed", "Audio", "Video"] as const;
type Filter = (typeof FILTERS)[number];

export default function CallsScreen() {
  const router = useRouter();
  const [calls, setCalls] = useState<CallHistoryItem[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const service = useMemo(
    () => new CallsService(
      process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080",
      () => accessTokenProvider.getAccessToken()
    ),
    []
  );

  useEffect(() => {
    let active = true;
    service.listHistory()
      .then((items) => active && setCalls(items))
      .catch((error) => {
        // 2026-08-07 crash fix: this had no .catch() at all. Since
        // accessTokenProvider fails closed until an account is active,
        // opening this — the app's default tab — always rejected, which is
        // an *unhandled* promise rejection Expo surfaces as a fatal
        // red-screen crash. Fail closed to an empty list instead.
        console.warn("[CallsScreen] failed to load call history:", error);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [service]);

  const visible = calls.filter((call) => {
    const q = query.trim().toLowerCase();
    const matchText = !q || call.peerDisplayName.toLowerCase().includes(q);
    const matchFilter =
      filter === "All" ||
      (filter === "Missed" && call.status === "MISSED") ||
      (filter === "Audio" && call.callType === "AUDIO") ||
      (filter === "Video" && call.callType === "VIDEO");
    return matchText && matchFilter;
  });

  const callActions = createActionsForPath("/calls");

  function onQuickCreateAction(key: CreateActionKey) {
    const selected = callActions.find((item) => item.key === key);
    setQuickCreateOpen(false);
    if (selected) router.push(selected.route as never);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>PRIVATE CALLING</Text>
          <Text style={styles.title}>Calls</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.iconButton} onPress={() => setQuickCreateOpen(true)}>
            <Ionicons name="add" size={22} color="#A9BDD0" />
          </Pressable>
          <Pressable style={styles.iconButton}>
            <Ionicons name="calendar-outline" size={20} color="#A9BDD0" />
          </Pressable>
          <Pressable style={[styles.iconButton, styles.primaryButton]}>
            <Ionicons name="call-outline" size={21} color="#001B24" />
          </Pressable>
        </View>
      </View>

      <View style={styles.securityCard}>
        <View style={styles.securityIcon}>
          <Ionicons name="shield-checkmark" size={20} color="#12D6AE" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.securityTitle}>Private calling mode</Text>
          <Text style={styles.securityCopy}>
            Relay-only calling can hide peer IP addresses.
          </Text>
        </View>
        <Text style={styles.manage}>Manage</Text>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={18} color="#6E879B" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search calls"
          placeholderTextColor="#6E879B"
          style={styles.searchInput}
        />
      </View>

      <View style={styles.filters}>
        {FILTERS.map((item) => (
          <Pressable
            key={item}
            onPress={() => setFilter(item)}
            style={[styles.chip, filter === item && styles.chipActive]}
          >
            <Text style={[
              styles.chipText,
              filter === item && styles.chipTextActive
            ]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <Text style={styles.loading}>Loading calls…</Text>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="call-outline" size={34} color="#4D8BFF" />
              </View>
              <Text style={styles.emptyTitle}>No calls found</Text>
              <Text style={styles.emptyCopy}>
                Start an encrypted audio or video call from a conversation.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.callRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {initials(item.peerDisplayName)}
                </Text>
              </View>

              <View style={styles.callInfo}>
                <Text style={styles.callName}>{item.peerDisplayName}</Text>
                <View style={styles.metaLine}>
                  <Ionicons
                    name={item.direction === "INCOMING" ? "arrow-down" : "arrow-up"}
                    size={14}
                    color={item.status === "MISSED" ? "#FF6B7A" : "#7D95A8"}
                  />
                  <Text style={[
                    styles.callMeta,
                    item.status === "MISSED" && styles.missed
                  ]}>
                    {item.status === "MISSED"
                      ? "Missed"
                      : new Date(item.createdAt).toLocaleString()}
                  </Text>
                </View>
              </View>

              <Pressable style={styles.rowAction}>
                <Ionicons
                  name={item.callType === "VIDEO" ? "videocam-outline" : "call-outline"}
                  size={21}
                  color="#12D6AE"
                />
              </Pressable>
            </View>
          )}
        />
      )}

      <QuickCreateSheet
        visible={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        actions={callActions}
        onAction={onQuickCreateAction}
      />
    </SafeAreaView>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520", paddingHorizontal: 16 },
  header: {
    marginTop: 12, marginBottom: 16, flexDirection: "row",
    justifyContent: "space-between", alignItems: "center"
  },
  eyebrow: { color: "#12D6AE", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: "#F7FBFF", fontSize: 31, fontWeight: "800", marginTop: 3 },
  headerActions: { flexDirection: "row", gap: 10 },
  iconButton: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: "#082739",
    borderWidth: 1, borderColor: "#17445A", alignItems: "center", justifyContent: "center"
  },
  primaryButton: { backgroundColor: "#12D6AE", borderColor: "#12D6AE" },
  securityCard: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#082739",
    borderRadius: 16, borderWidth: 1, borderColor: "#17445A", padding: 14
  },
  securityIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: "#073B3C",
    alignItems: "center", justifyContent: "center"
  },
  securityTitle: { color: "#EDF8FF", fontWeight: "800", fontSize: 14 },
  securityCopy: { color: "#7F98AB", fontSize: 12, marginTop: 2 },
  manage: { color: "#12D6AE", fontWeight: "800", fontSize: 12 },
  search: {
    height: 48, borderRadius: 14, backgroundColor: "#072536", borderWidth: 1,
    borderColor: "#17445A", marginTop: 14, paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", gap: 10
  },
  searchInput: { flex: 1, color: "#F4FAFF", fontSize: 15 },
  filters: { flexDirection: "row", gap: 8, marginVertical: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: "#082536" },
  chipActive: { backgroundColor: "#0A4D4A", borderWidth: 1, borderColor: "#12D6AE" },
  chipText: { color: "#7892A6", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#12D6AE" },
  loading: { color: "#7D95A8", textAlign: "center", marginTop: 80 },
  list: { paddingBottom: 120 },
  callRow: {
    minHeight: 76, backgroundColor: "#082536", borderWidth: 1,
    borderColor: "#17445A", borderRadius: 16, padding: 12, marginBottom: 10,
    flexDirection: "row", alignItems: "center"
  },
  avatar: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: "#673DE6",
    alignItems: "center", justifyContent: "center"
  },
  avatarText: { color: "white", fontWeight: "800", fontSize: 15 },
  callInfo: { flex: 1, marginLeft: 12 },
  callName: { color: "#F3FAFF", fontSize: 15, fontWeight: "800" },
  metaLine: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  callMeta: { color: "#7D95A8", fontSize: 12 },
  missed: { color: "#FF6B7A" },
  rowAction: {
    width: 42, height: 42, borderRadius: 13, backgroundColor: "#073B3C",
    alignItems: "center", justifyContent: "center"
  },
  empty: { alignItems: "center", paddingTop: 70, paddingHorizontal: 32 },
  emptyIcon: {
    width: 82, height: 82, borderRadius: 41, backgroundColor: "#0A2851",
    alignItems: "center", justifyContent: "center", marginBottom: 16
  },
  emptyTitle: { color: "#F7FBFF", fontSize: 19, fontWeight: "800" },
  emptyCopy: { color: "#7D95A8", fontSize: 13, textAlign: "center", lineHeight: 19, marginTop: 6 }
});

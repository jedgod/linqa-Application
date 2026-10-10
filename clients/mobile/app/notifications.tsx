import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { getApiBaseUrl } from "../config/api";
import { HomeFeedService, type HomeNotifications } from "../services/home-feed.service";
import { accessTokenProvider } from "../services/session";

type Row = { key: string; icon: keyof typeof Ionicons.glyphMap; color: string; title: string; detail: string; route: string };

/** Everything that needs attention, in one place. Each row opens the screen where it is handled. */
export default function NotificationsScreen() {
  const router = useRouter();
  const home = useMemo(() => new HomeFeedService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [counts, setCounts] = useState<HomeNotifications | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    home.loadFeed().then(
      (feed) => { setCounts(feed.notifications ?? null); setLoading(false); },
      () => { setError("Could not load your notifications. Pull down to try again."); setLoading(false); }
    );
  }, [home]);
  useFocusEffect(load);

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const rows: Row[] = [];
  if (counts) {
    if (counts.unreadMessages > 0) rows.push({ key: "unread", icon: "chatbubble-ellipses-outline", color: "#5B4CFF", title: plural(counts.unreadMessages, "unread message"), detail: `In ${plural(counts.unreadConversations, "chat")}`, route: "/(tabs)/chats" });
    if (counts.pendingMessageRequests > 0) rows.push({ key: "requests", icon: "person-add-outline", color: "#00AFC8", title: plural(counts.pendingMessageRequests, "message request"), detail: "People who want to message you", route: "/message-requests" });
    if (counts.missedCalls > 0) rows.push({ key: "missed", icon: "call-outline", color: "#E5484D", title: plural(counts.missedCalls, "missed call"), detail: "Open your call history", route: "/(tabs)/calls" });
    if (counts.unacknowledgedSecurityAlerts > 0) rows.push({ key: "security", icon: "shield-outline", color: "#D92D20", title: plural(counts.unacknowledgedSecurityAlerts, "security alert"), detail: "Review activity on your account", route: "/modules/security" });
    if (counts.pendingCountryLinqaNotifications > 0) rows.push({ key: "country", icon: "globe-outline", color: "#7457F5", title: plural(counts.pendingCountryLinqaNotifications, "CountryLinqa update"), detail: "Communities, people and events", route: "/countrylinqa/notifications" });
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={24} color="#171A35" /></Pressable>
        <Text accessibilityRole="header" style={styles.title}>Notifications</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Notification settings" onPress={() => router.push("/settings/notifications")} hitSlop={10}><Ionicons name="settings-outline" size={22} color="#171A35" /></Pressable>
      </View>

      {loading && !counts ? <ActivityIndicator color="#5B4CFF" style={{ marginTop: 40 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        refreshControl={<RefreshControl refreshing={loading && !!counts} onRefresh={load} tintColor="#5B4CFF" />}
        contentContainerStyle={{ paddingBottom: 32 }}
        ListEmptyComponent={!loading && !error ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={44} color="#16B874" />
            <Text style={styles.emptyTitle}>You are all caught up</Text>
            <Text style={styles.emptyBody}>New messages, requests, missed calls and security alerts show up here.</Text>
          </View>
        ) : null}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push(item.route as never)} style={styles.row}>
            <View style={[styles.icon, { backgroundColor: `${item.color}16` }]}><Ionicons name={item.icon} size={22} color={item.color} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowDetail}>{item.detail}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9095A9" />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F8FC", paddingHorizontal: 16 },
  header: { paddingTop: 18, paddingBottom: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: "#171A35", fontSize: 20, fontWeight: "800" },
  error: { color: "#B42318", paddingVertical: 8 },
  row: { minHeight: 76, borderBottomWidth: 1, borderBottomColor: "#E7E9F1", flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowTitle: { color: "#1A1D38", fontSize: 16, fontWeight: "700" },
  rowDetail: { color: "#747A91", fontSize: 13, marginTop: 3 },
  empty: { alignItems: "center", gap: 8, marginTop: 70, paddingHorizontal: 24 },
  emptyTitle: { color: "#171A35", fontSize: 18, fontWeight: "700" },
  emptyBody: { color: "#747A91", fontSize: 14, textAlign: "center", lineHeight: 20 }
});

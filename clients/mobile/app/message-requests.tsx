import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  MessageRequestService,
  type MessageRequest,
} from "../services/message-request.service";
import { accessTokenProvider } from "../services/session";

export default function MessageRequestsScreen() {
  const service = useMemo(
    () =>
      new MessageRequestService(
        process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8080",
        () => accessTokenProvider.getAccessToken(),
      ),
    [],
  );

  const [requests, setRequests] = useState<MessageRequest[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRequests(await service.list());
    } catch (error) {
      // 2026-08-07 crash fix: try/finally with no catch re-throws after
      // finally runs. Called as `void load()` in a useEffect below, that
      // became an unhandled promise rejection — a fatal crash instead of
      // this screen just failing closed to an empty list.
      console.warn("[MessageRequestsScreen] failed to load requests:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(
    requestId: string,
    action: "ACCEPT" | "DECLINE" | "BLOCK" | "REPORT",
  ) {
    // 2026-08-07 crash fix: called as `onPress={() => act(...)}` with
    // nothing awaiting or catching the returned promise — a rejection here
    // was an unhandled rejection on every tap, not just on load.
    try {
      await service.resolve(requestId, action);
    } catch (error) {
      console.warn("[MessageRequestsScreen] failed to resolve request:", error);
      return;
    }
    setRequests((current) =>
      current.filter((request) => request.id !== requestId),
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>PRIVACY FILTER</Text>
          <Text style={styles.title}>Message requests</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{requests.length}</Text>
        </View>
      </View>

      <View style={styles.notice}>
        <Ionicons name="eye-off-outline" size={19} color="#12D6AE" />
        <Text style={styles.noticeText}>
          Previewing a request does not send a read receipt.
        </Text>
      </View>

      {loading ? (
        <Text style={styles.loading}>Loading requests…</Text>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name="shield-checkmark-outline"
                size={44}
                color="#12D6AE"
              />
              <Text style={styles.emptyTitle}>No pending requests</Text>
              <Text style={styles.emptyCopy}>
                Messages from unknown senders will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.topRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {initials(item.senderDisplayName)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.senderDisplayName}</Text>
                  <Text style={styles.meta}>
                    {item.mutualContacts} mutual contacts ·{" "}
                    {new Date(item.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                {item.riskLevel !== "LOW" && (
                  <Ionicons
                    name="warning-outline"
                    size={20}
                    color="#FFB84D"
                  />
                )}
              </View>

              <View style={styles.preview}>
                <Text numberOfLines={3} style={styles.previewText}>
                  {item.preview}
                </Text>
              </View>

              <View style={styles.actions}>
                <Pressable
                  style={[styles.action, styles.accept]}
                  onPress={() => act(item.id, "ACCEPT")}
                >
                  <Text style={styles.acceptText}>Accept</Text>
                </Pressable>

                <Pressable
                  style={styles.action}
                  onPress={() => act(item.id, "DECLINE")}
                >
                  <Text style={styles.actionText}>Decline</Text>
                </Pressable>

                <Pressable
                  style={styles.iconAction}
                  onPress={() => act(item.id, "BLOCK")}
                >
                  <Ionicons name="ban-outline" size={19} color="#FF6B7A" />
                </Pressable>

                <Pressable
                  style={styles.iconAction}
                  onPress={() => act(item.id, "REPORT")}
                >
                  <Ionicons name="flag-outline" size={19} color="#FFB84D" />
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520", paddingHorizontal: 16 },
  header: {
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#12D6AE",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  title: {
    color: "#F5FBFF",
    fontSize: 26,
    fontWeight: "900",
    marginTop: 3,
  },
  badge: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#12D6AE",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#00212A", fontWeight: "900" },
  notice: {
    flexDirection: "row",
    gap: 9,
    backgroundColor: "#073B3C",
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  noticeText: { flex: 1, color: "#9BC8C5", fontSize: 12, lineHeight: 17 },
  loading: { color: "#7D95A8", textAlign: "center", marginTop: 80 },
  list: { paddingBottom: 80 },
  empty: { alignItems: "center", paddingTop: 90, paddingHorizontal: 32 },
  emptyTitle: {
    color: "#F4FAFF",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 14,
  },
  emptyCopy: {
    color: "#7891A4",
    fontSize: 13,
    textAlign: "center",
    marginTop: 6,
  },
  card: {
    backgroundColor: "#082536",
    borderWidth: 1,
    borderColor: "#17445A",
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#6548D8",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "white", fontWeight: "900" },
  name: { color: "#F3F9FD", fontSize: 15, fontWeight: "800" },
  meta: { color: "#748EA1", fontSize: 11, marginTop: 4 },
  preview: {
    marginTop: 12,
    backgroundColor: "#061E2C",
    borderRadius: 13,
    padding: 12,
  },
  previewText: { color: "#AFC1CC", fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  action: {
    height: 40,
    borderRadius: 12,
    paddingHorizontal: 15,
    backgroundColor: "#0D3447",
    alignItems: "center",
    justifyContent: "center",
  },
  accept: { backgroundColor: "#12D6AE" },
  acceptText: { color: "#001D26", fontWeight: "900" },
  actionText: { color: "#D6E4EC", fontWeight: "800" },
  iconAction: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#0D3447",
    alignItems: "center",
    justifyContent: "center",
  },
});

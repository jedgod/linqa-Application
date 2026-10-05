import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { MediaService, type MediaItem } from "../../services/media.service";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";

const FILTERS = ["ALL", "IMAGE", "VIDEO", "VOICE_NOTE", "DOCUMENT", "LINK"] as const;
type Filter = (typeof FILTERS)[number];

export default function MediaScreen() {
  const service = useMemo(
    () =>
      new MediaService(
        getApiBaseUrl(),
        () => accessTokenProvider.getAccessToken(),
      ),
    [],
  );

  const [filter, setFilter] = useState<Filter>("ALL");
  const [items, setItems] = useState<MediaItem[]>([]);

  useEffect(() => {
    let active = true;
    service
      .list(filter === "ALL" ? undefined : filter)
      .then((result) => active && setItems(result))
      .catch((error) => {
        // 2026-08-07 crash fix: unguarded .then() with no .catch() — an
        // unhandled promise rejection (e.g. no account active yet) crashed
        // the app. Fail closed to an empty list instead.
        console.warn("[MediaScreen] failed to load media:", error);
      });
    return () => {
      active = false;
    };
  }, [filter, service]);

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>SHARED CONTENT</Text>
          <Text style={styles.title}>Media</Text>
        </View>
        <Pressable style={styles.actionButton}>
          <Ionicons name="search" size={20} color="#AFC2CF" />
        </Pressable>
      </View>

      <FlatList
        horizontal
        data={FILTERS}
        keyExtractor={(item) => item}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setFilter(item)}
            style={[styles.chip, filter === item && styles.chipActive]}
          >
            <Text style={[
              styles.chipText,
              filter === item && styles.chipTextActive,
            ]}>
              {label(item)}
            </Text>
          </Pressable>
        )}
      />

      <View style={styles.storageCard}>
        <View>
          <Text style={styles.storageTitle}>Storage used</Text>
          <Text style={styles.storageValue}>2.4 GB of 10 GB</Text>
        </View>
        <Pressable>
          <Text style={styles.manage}>Manage</Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="images-outline" size={42} color="#4D8BFF" />
            <Text style={styles.emptyTitle}>No media yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card}>
            <View style={styles.thumbnail}>
              <Ionicons
                name={iconFor(item.mediaType)}
                size={32}
                color="#12D6AE"
              />
            </View>
            <Text numberOfLines={1} style={styles.cardTitle}>
              {item.title}
            </Text>
            <View style={styles.cardMeta}>
              <Text style={styles.cardDate}>
                {new Date(item.createdAt).toLocaleDateString()}
              </Text>
              {item.starred && (
                <Ionicons name="star" size={14} color="#FFCA57" />
              )}
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function label(value: Filter) {
  return value === "ALL" ? "All" : value.replace("_", " ").toLowerCase();
}

function iconFor(type: string): keyof typeof Ionicons.glyphMap {
  if (type === "IMAGE") return "image-outline";
  if (type === "VIDEO") return "videocam-outline";
  if (type === "VOICE_NOTE") return "mic-outline";
  if (type === "DOCUMENT") return "document-outline";
  return "link-outline";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520", paddingHorizontal: 16 },
  header: {
    paddingTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eyebrow: {
    color: "#12D6AE",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  title: { color: "#F4FAFF", fontSize: 29, fontWeight: "900", marginTop: 2 },
  actionButton: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: "#082536",
    borderWidth: 1,
    borderColor: "#17445A",
    alignItems: "center",
    justifyContent: "center",
  },
  filters: { gap: 8, paddingVertical: 14 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#082536",
  },
  chipActive: {
    backgroundColor: "#0A4D4A",
    borderWidth: 1,
    borderColor: "#12D6AE",
  },
  chipText: { color: "#7F98AA", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#12D6AE" },
  storageCard: {
    backgroundColor: "#082536",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#17445A",
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  storageTitle: { color: "#7F98AA", fontSize: 12 },
  storageValue: { color: "#F0F7FC", fontSize: 15, fontWeight: "800", marginTop: 3 },
  manage: { color: "#12D6AE", fontWeight: "800" },
  columns: { gap: 10 },
  grid: { paddingBottom: 100 },
  card: {
    flex: 1,
    maxWidth: "49%",
    backgroundColor: "#082536",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#17445A",
    padding: 10,
    marginBottom: 10,
  },
  thumbnail: {
    height: 120,
    borderRadius: 13,
    backgroundColor: "#061E2C",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { color: "#ECF5FA", fontWeight: "800", marginTop: 9 },
  cardMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  cardDate: { color: "#70889A", fontSize: 10 },
  empty: { alignItems: "center", paddingTop: 90 },
  emptyTitle: { color: "#F4FAFF", fontSize: 17, fontWeight: "800", marginTop: 12 },
});

import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { HUB_GROUPS, LINQA_HUB_SERVICES } from "../navigation/information-architecture";
import { useLinqaSendAvailability } from "../services/linqasend-availability";

const FILTERS = ["All", ...HUB_GROUPS] as const;

export default function SearchScreen() {
  const moneyAvailable = useLinqaSendAvailability() === true;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  const results = useMemo(() => LINQA_HUB_SERVICES.filter((item) => {
    if (!moneyAvailable && item.key === "send") return false;
    const q = query.trim().toLowerCase();
    return (!q || `${item.title} ${item.description} ${item.group}`.toLowerCase().includes(q)) &&
      (filter === "All" || item.group === filter);
  }), [query, filter, moneyAvailable]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color="#222640" />
        </Pressable>
        <Text style={styles.title}>Search Linqa</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={19} color="#738EA1" />
        <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search services, settings and actions" placeholderTextColor="#81879D" style={styles.input} />
      </View>

      <FlatList
        horizontal
        data={FILTERS}
        keyExtractor={(item) => item}
        contentContainerStyle={styles.filters}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable onPress={() => setFilter(item)} style={[styles.chip, filter === item && styles.chipActive]}>
            <Text style={[styles.chipText, filter === item && styles.chipTextActive]}>{item}</Text>
          </Pressable>
        )}
      />

      <FlatList
        data={results}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>No matching Linqa service.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(item.route as never)} accessibilityRole="button">
            <View style={[styles.icon, { backgroundColor: `${item.color}16` }]}>
              <Ionicons name={item.icon} size={21} color={item.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultTitle}>{item.title}</Text>
              <Text style={styles.resultSubtitle}>{item.group} · {item.description}</Text>
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
  search: { height: 50, borderRadius: 15, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E3E5EE", flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 },
  input: { flex: 1, color: "#171A35", fontSize: 15 },
  filters: { gap: 8, paddingVertical: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7F0" },
  chipActive: { backgroundColor: "#EEEAFE", borderColor: "#5B4CFF" },
  chipText: { color: "#7F849A", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#5B4CFF" },
  row: { minHeight: 72, borderBottomWidth: 1, borderBottomColor: "#E7E9F1", flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  resultTitle: { color: "#1A1D38", fontSize: 15, fontWeight: "800" },
  resultSubtitle: { color: "#747A91", fontSize: 12, marginTop: 3 },
  empty: { color: "#73798E", textAlign: "center", marginTop: 40 }
});

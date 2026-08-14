import React, { useMemo, useState } from "react";
import {
  FlatList, Pressable, SafeAreaView, StyleSheet,
  Text, TextInput, View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const DATA = [
  { id: "1", type: "People", title: "Avery Chen", subtitle: "Active now" },
  { id: "2", type: "Chats", title: "Design Sync", subtitle: "Group conversation" },
  { id: "3", type: "Calls", title: "Priya Nair", subtitle: "Missed audio call" },
  { id: "4", type: "Media", title: "Launch wireframes", subtitle: "6 images" },
  { id: "5", type: "Communities", title: "Product Circle", subtitle: "128 members" },
];

const FILTERS = ["All", "People", "Chats", "Calls", "Media", "Communities"];

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");

  const results = useMemo(() => DATA.filter((item) => {
    const q = query.trim().toLowerCase();
    return (!q || item.title.toLowerCase().includes(q)) &&
      (filter === "All" || item.type === filter);
  }), [query, filter]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Ionicons name="arrow-back" size={24} color="#AFC2CF" />
        <Text style={styles.title}>Search</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={19} color="#738EA1" />
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Search Linqa"
          placeholderTextColor="#738EA1"
          style={styles.input}
        />
      </View>

      <FlatList
        horizontal
        data={FILTERS}
        keyExtractor={(item) => item}
        contentContainerStyle={styles.filters}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setFilter(item)}
            style={[styles.chip, filter === item && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === item && styles.chipTextActive]}>
              {item}
            </Text>
          </Pressable>
        )}
      />

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={styles.row}>
            <View style={styles.icon}>
              <Ionicons name="search-outline" size={20} color="#12D6AE" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultTitle}>{item.title}</Text>
              <Text style={styles.resultSubtitle}>{item.type} · {item.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#466176" />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520", paddingHorizontal: 16 },
  header: {
    paddingTop: 18, paddingBottom: 16, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between"
  },
  title: { color: "#F4FAFF", fontSize: 20, fontWeight: "800" },
  search: {
    height: 50, borderRadius: 15, backgroundColor: "#082536", borderWidth: 1,
    borderColor: "#17445A", flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, gap: 10
  },
  input: { flex: 1, color: "white", fontSize: 15 },
  filters: { gap: 8, paddingVertical: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#082536" },
  chipActive: { backgroundColor: "#0A4D4A", borderWidth: 1, borderColor: "#12D6AE" },
  chipText: { color: "#7F98AA", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#12D6AE" },
  row: {
    minHeight: 72, borderBottomWidth: 1, borderBottomColor: "#123649",
    flexDirection: "row", alignItems: "center", gap: 12
  },
  icon: {
    width: 44, height: 44, borderRadius: 13, backgroundColor: "#073B3C",
    alignItems: "center", justifyContent: "center"
  },
  resultTitle: { color: "#EEF8FE", fontSize: 15, fontWeight: "800" },
  resultSubtitle: { color: "#718A9C", fontSize: 12, marginTop: 3 }
});

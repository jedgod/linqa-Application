import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { HUB_GROUPS, LINQA_HUB_SERVICES } from "../../navigation/information-architecture";

export default function LinqaHubScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const services = useMemo(() => LINQA_HUB_SERVICES.filter((service) =>
    !normalized || `${service.title} ${service.description} ${service.group}`.toLowerCase().includes(normalized)
  ), [normalized]);

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.intro}>
          <Text style={s.eyebrow}>EVERYTHING IN ONE PLACE</Text>
          <Text style={s.title}>Linqa</Text>
          <Text style={s.subtitle}>Connect, organize, discover, send and stay secure.</Text>
        </View>

        <View style={s.search}>
          <Ionicons name="search" size={20} color="#6B7190" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a Linqa service"
            placeholderTextColor="#8C91AA"
            style={s.searchInput}
          />
          <Pressable onPress={() => router.push("/search")} accessibilityLabel="Open universal search">
            <Ionicons name="sparkles-outline" size={20} color="#5B4CFF" />
          </Pressable>
        </View>

        {HUB_GROUPS.map((group) => {
          const grouped = services.filter((service) => service.group === group);
          if (!grouped.length) return null;
          return (
            <View key={group} style={s.section}>
              <Text style={s.sectionTitle}>{group}</Text>
              <View style={s.grid}>
                {grouped.map((service) => (
                  <Pressable
                    key={service.key}
                    style={s.card}
                    onPress={() => router.push(service.route as never)}
                    accessibilityRole="button"
                    accessibilityLabel={service.title}
                  >
                    <View style={[s.icon, { backgroundColor: `${service.color}16` }]}>
                      <Ionicons name={service.icon} size={25} color={service.color} />
                    </View>
                    <View style={s.cardCopy}>
                      <Text style={s.cardTitle}>{service.title}</Text>
                      <Text style={s.cardDescription}>{service.description}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#B0B4C5" />
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}

        {!services.length ? (
          <View style={s.empty}>
            <Ionicons name="search-outline" size={30} color="#8C91AA" />
            <Text style={s.emptyTitle}>No service found</Text>
            <Text style={s.emptyText}>Try calls, vault, money or privacy.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F8FC" },
  content: { padding: 18, paddingBottom: 110 },
  intro: { paddingVertical: 10 },
  eyebrow: { color: "#5B4CFF", fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: "#11142D", fontSize: 34, lineHeight: 40, fontWeight: "900", marginTop: 4 },
  subtitle: { color: "#666C86", fontSize: 14, lineHeight: 20, marginTop: 3 },
  search: { minHeight: 54, marginTop: 14, paddingHorizontal: 15, borderRadius: 17, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7F0", flexDirection: "row", alignItems: "center", gap: 10 },
  searchInput: { flex: 1, color: "#171A35", fontSize: 15 },
  section: { marginTop: 25 },
  sectionTitle: { color: "#20233D", fontSize: 14, fontWeight: "900", marginBottom: 10 },
  grid: { gap: 9 },
  card: { minHeight: 78, padding: 13, borderRadius: 18, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E9EAF2", flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  cardCopy: { flex: 1 },
  cardTitle: { color: "#151831", fontSize: 15, fontWeight: "800" },
  cardDescription: { color: "#747A91", fontSize: 12, lineHeight: 17, marginTop: 3 },
  empty: { paddingVertical: 50, alignItems: "center" },
  emptyTitle: { color: "#20233D", fontSize: 17, fontWeight: "800", marginTop: 10 },
  emptyText: { color: "#7D8298", fontSize: 13, textAlign: "center", marginTop: 5 }
});

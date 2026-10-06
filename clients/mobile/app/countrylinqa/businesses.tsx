import { useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Empty, Spinner, WorldHeader, WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { useCollection, useMyCountry } from "../../components/countrylinqa/useWorld";
import { Avatar } from "../../components/linqasend/ui";
import { categoryChips, titleCase } from "../../services/countrylinqa-world";
import { fonts } from "../../theme/tokens";

/**
 * 3.8 Businesses: businesses that chose to reach your country or region. Categories come from what
 * businesses have registered. There are no ratings or reviews yet, so none are shown.
 */
export default function CountryLinqaBusinesses() {
  const router = useRouter();
  const params = useLocalSearchParams<{ country?: string; title?: string }>();
  const me = useMyCountry();
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const place = !!params.country;
  const q = query.trim();
  const list = useCollection("businesses", { ...(category ? { category } : {}), ...(params.country ? { country: params.country } : {}), ...(q ? { q } : {}) }, `${category ?? ""}|${q}|${params.country ?? ""}`);
  // The chips are built from the unfiltered list, so choosing one does not make the others disappear.
  const known = useRef<string[]>([]);
  if (!category && !q) known.current = categoryChips(list.items.map((b) => b.category));
  const chips = known.current;

  return (
    <WorldScreen>
      <WorldHeader title={params.title ? `Businesses · ${params.title}` : "Businesses"} back={place}
        {...(place ? {} : me.name ? { subtitle: me.name, onSubtitle: () => router.push("/countrylinqa/countries") } : {})} />
      <View style={s.search}><Ionicons name="search" size={18} color={world.faint} /><TextInput accessibilityLabel="Search businesses" value={query} onChangeText={setQuery} placeholder="Search businesses" placeholderTextColor={world.faint} style={s.searchInput} /></View>
      {chips.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {[null, ...chips].map((c) => (
            <Pressable key={c ?? "all"} accessibilityRole="button" accessibilityState={{ selected: category === c }} style={[s.chip, category === c && s.chipOn]} onPress={() => setCategory(c)}>
              <Text style={[s.chipText, category === c && { color: "#FFFFFF" }]}>{c ? titleCase(c) : "All"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
        {list.error ? <Empty icon="cloud-offline-outline" title="Can not load businesses" text={list.error} action={{ label: "Try again", onPress: () => void list.reload() }} /> : null}
        {list.loading && list.items.length === 0 ? <Spinner /> : null}
        {list.items.map((b) => (
          <View key={b.id} style={s.row} accessible accessibilityLabel={`${b.title}${b.category ? `, ${titleCase(b.category)}` : ""}`}>
            {b.logoUrl ? <Image source={{ uri: b.logoUrl }} style={s.logo} accessibilityIgnoresInvertColors /> : <Avatar name={b.title} size={64} />}
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={2}>{b.title}</Text>
              {b.category ? <Text style={s.meta}>{titleCase(b.category)}</Text> : null}
            </View>
          </View>
        ))}
        {!list.loading && !list.error && list.items.length === 0 ? <Empty icon="storefront-outline" title="No businesses yet" text="Businesses outside your discovery reach never appear here. Try another category, or widen your reach in settings." action={{ label: "Discovery settings", onPress: () => router.push("/settings/countrylinqa") }} /> : null}
        {list.page && !list.loading ? <Pressable accessibilityRole="button" style={s.more} onPress={() => void list.more()}><Text style={s.moreText}>Load more</Text></Pressable> : null}
      </ScrollView>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, marginHorizontal: 20, borderRadius: 14, borderWidth: 1, borderColor: world.border, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: world.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 8 },
  chips: { gap: 10, paddingHorizontal: 20, paddingVertical: 12 },
  chip: { minHeight: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: world.chip, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: world.purple },
  chipText: { color: world.purple, fontFamily: fonts.semibold, fontSize: 14 },
  list: { paddingHorizontal: 20, paddingBottom: 28 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 88, borderBottomWidth: 1, borderBottomColor: world.border },
  logo: { width: 64, height: 64, borderRadius: 12 },
  name: { color: world.text, fontFamily: fonts.bold, fontSize: 16 },
  meta: { color: world.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  more: { alignItems: "center", justifyContent: "center", minHeight: 56 },
  moreText: { color: world.purple, fontFamily: fonts.bold, fontSize: 16 }
});

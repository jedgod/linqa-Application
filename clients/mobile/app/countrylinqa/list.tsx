import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CountryLinqaService } from "../../services/countrylinqa.service";
import { accessTokenProvider } from "../../services/session";
import { colors, radius, spacing } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";

const API = getApiBaseUrl();

type Row = Record<string, unknown>;

function fieldsForKind(kind: string): { primary: string; secondary?: string } {
  switch (kind) {
    case "businesses":
      return { primary: "name", secondary: "category" };
    case "events":
      return { primary: "title", secondary: "startsAt" };
    case "communities":
      return { primary: "name", secondary: "memberCount" };
    case "people":
      return { primary: "displayName", secondary: "countryCode" };
    default:
      return { primary: "title", secondary: "createdAt" };
  }
}

/**
 * Expo counterpart to `clients/android/.../ui/screens/CountryLinqaListScreen.kt`:
 * one reusable "loading → empty → row list" surface shared by every
 * CountryLinqa collection, instead of a bespoke screen per pack ("world
 * feed", "businesses", "events", "communities" all shared this same shape
 * in every pack screen that showed them).
 */
export default function CountryLinqaListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind: string; title?: string }>();
  const kind = params.kind ?? "feed";
  const client = useMemo(() => new CountryLinqaService(API, () => accessTokenProvider.getAccessToken()), []);
  const [items, setItems] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { primary, secondary } = fieldsForKind(kind);

  useEffect(() => {
    let load: Promise<{ items: Row[] }>;
    switch (kind) {
      case "businesses":
        load = client.businesses();
        break;
      case "events":
        load = client.events();
        break;
      case "communities":
        load = client.communitiesMine();
        break;
      case "people":
        load = client.discoverUsers();
        break;
      default:
        load = client.worldFeed();
    }
    load
      .then((response) => setItems(response.items))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Unable to load this list.");
        setItems([]);
      });
  }, [client, kind]);

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={s.back}>←</Text>
        </Pressable>
        <Text style={s.headerTitle}>{params.title ?? "Linqa World"}</Text>
      </View>
      {items === null && (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
      {items !== null && items.length === 0 && (
        <View style={s.center}>
          <Text style={s.muted}>{error ?? "Nothing here yet."}</Text>
        </View>
      )}
      {items !== null && items.length > 0 && (
        <ScrollView contentContainerStyle={s.content}>
          {items.map((item, i) => (
            <View key={i} style={s.row}>
              <Text style={s.rowTitle}>{String(item[primary] ?? "—")}</Text>
              {secondary && item[secondary] !== undefined && <Text style={s.rowSub}>{String(item[secondary])}</Text>}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, paddingTop: 52 },
  back: { color: colors.text, fontSize: 20 },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  muted: { color: colors.textFaint, fontSize: 13 },
  content: { padding: spacing.lg },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  rowTitle: { color: colors.text, fontWeight: "700" },
  rowSub: { color: colors.textFaint, fontSize: 12, marginTop: 4 }
});

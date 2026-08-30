import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MobileHubService, type HomeFeed, type HomeNewsStory } from "../../services/mobile-hub.service";
import { accessTokenProvider } from "../../services/session";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";

export default function GlobalNewsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const client = useMemo(() => new MobileHubService(API, () => accessTokenProvider.getAccessToken()), []);
  const [feed, setFeed] = useState<HomeFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    client.loadHomeFeed().then(setFeed).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load global news." )).finally(() => setLoading(false));
  }, [client]);
  useEffect(load, [load]);

  const selectedCategory = params.category?.toUpperCase();
  const stories = (feed?.news.stories ?? []).filter((story) => !selectedCategory || story.category === selectedCategory);

  async function openStory(story: HomeNewsStory) {
    try { await Linking.openURL(story.url); }
    catch { setError("This publisher link could not be opened."); }
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable style={s.back} onPress={() => router.back()} accessibilityLabel="Back"><Ionicons name="chevron-back" size={24} color="#11152E" /></Pressable>
        <View style={s.headerCopy}><Text style={s.eyebrow}>LINQA WORLD NEWS</Text><Text style={s.title}>{selectedCategory ? `${selectedCategory.charAt(0)}${selectedCategory.slice(1).toLowerCase()} stories` : "Breaking around the world"}</Text></View>
        <View style={[s.status, feed?.news.status !== "LIVE" && s.statusMuted]}><View style={s.statusDot} /><Text style={s.statusText}>{feed?.news.status ?? "SYNC"}</Text></View>
      </View>
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} colors={["#5B4CFF"]} />}>
        <Text style={s.disclosure}>Headlines open on the original publisher’s website. Updated through Linqa’s global news service.</Text>
        {error ? <Pressable style={s.error} onPress={load}><Text style={s.errorText}>{error} Tap to retry.</Text></Pressable> : null}
        {loading && !feed ? <ActivityIndicator color="#5B4CFF" style={{ marginTop: 80 }} /> : null}
        {!loading && stories.length === 0 ? <View style={s.empty}><Ionicons name="cloud-offline-outline" size={34} color="#667085" /><Text style={s.emptyTitle}>No live stories available</Text><Text style={s.emptyCopy}>Pull down to refresh the global feed.</Text></View> : null}
        {stories.map((story) => (
          <Pressable key={story.id} style={s.card} onPress={() => void openStory(story)}>
            {story.imageUrl ? <Image source={{ uri: story.imageUrl }} style={s.image} /> : <View style={[s.image, s.imageFallback]}><Ionicons name="newspaper-outline" size={28} color="#6B5CFF" /></View>}
            <View style={s.body}>
              <View style={s.metaRow}><Text style={s.category}>{story.category}</Text><Text style={s.age}>{relativeAge(story.publishedAt)}</Text></View>
              <Text style={s.storyTitle} numberOfLines={3}>{story.title}</Text>
              <View style={s.sourceRow}><Text style={s.source} numberOfLines={1}>{story.source}{story.sourceCountry ? ` · ${story.sourceCountry}` : ""}</Text><Ionicons name="open-outline" size={16} color="#667085" /></View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function relativeAge(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F7FC" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#E5E9F2", backgroundColor: "#FFFFFF" },
  back: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#F2F4F8" },
  headerCopy: { flex: 1, marginLeft: 12 },
  eyebrow: { color: "#5B4CFF", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  title: { color: "#11152E", fontSize: 18, fontWeight: "900", marginTop: 2 },
  status: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: "#E9FBF4" },
  statusMuted: { backgroundColor: "#EEF1F6" },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#12B76A" },
  statusText: { color: "#137A54", fontSize: 8, fontWeight: "900" },
  content: { padding: 18, paddingBottom: 40 },
  disclosure: { color: "#667085", fontSize: 11, lineHeight: 16, marginBottom: 12 },
  error: { padding: 11, backgroundColor: "#FEF3F2", borderRadius: 10, marginBottom: 10 },
  errorText: { color: "#B42318", fontSize: 11 },
  card: { flexDirection: "row", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E4E8F0", borderRadius: 16, padding: 10, marginBottom: 10, shadowColor: "#101828", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  image: { width: 92, minHeight: 92, borderRadius: 12 },
  imageFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "#F0EEFF" },
  body: { flex: 1, marginLeft: 11 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  category: { color: "#6B5CFF", fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  age: { color: "#98A2B3", fontSize: 9 },
  storyTitle: { color: "#101828", fontSize: 13, lineHeight: 17, fontWeight: "800", marginTop: 6 },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: "auto" },
  source: { flex: 1, color: "#667085", fontSize: 9.5 },
  empty: { alignItems: "center", paddingTop: 90 },
  emptyTitle: { color: "#101828", fontSize: 17, fontWeight: "900", marginTop: 12 },
  emptyCopy: { color: "#667085", fontSize: 12, marginTop: 5 }
});

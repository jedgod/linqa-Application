import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  HomeFeedService,
  JurisdictionRequiredError,
  attributionFor,
  relativeAge,
  type HomeLiveUpdate
} from "../../services/home-feed.service";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";

const API = getApiBaseUrl();
const PAGE_SIZE = 20;

const CATEGORIES = [
  "ALL",
  "WORLD",
  "POLITICS",
  "TECHNOLOGY",
  "HEALTH",
  "CLIMATE",
  "BUSINESS",
  "SCIENCE",
  "SPORTS"
] as const;

/**
 * Linqa World News.
 *
 * Reads `GET /v1/mobile/home/news`, which is served from the durable store
 * rather than from a live provider call. That is deliberate: articles already
 * validated against the publisher allowlist stay readable while every upstream
 * provider is down, and no story reaches this screen without its attribution.
 */
export default function GlobalNewsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const client = useMemo(() => new HomeFeedService(API, () => accessTokenProvider.getAccessToken()), []);

  const [category, setCategory] = useState<string>((params.category ?? "ALL").toUpperCase());
  const [articles, setArticles] = useState<HomeLiveUpdate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (selected: string) => {
      setLoading(true);
      setError(null);
      client
        .loadNews({ ...(selected === "ALL" ? {} : { category: selected }), limit: PAGE_SIZE, offset: 0 })
        .then((page) => {
          setArticles(page.articles);
          setTotal(page.total);
        })
        .catch((cause: unknown) => {
          if (cause instanceof JurisdictionRequiredError) {
            router.push("/settings/countrylinqa");
            return;
          }
          setError(cause instanceof Error ? cause.message : "Unable to load global news.");
        })
        .finally(() => setLoading(false));
    },
    [client, router]
  );

  useEffect(() => load(category), [load, category]);

  async function loadMore() {
    if (loadingMore || articles.length >= total) return;
    setLoadingMore(true);
    try {
      const page = await client.loadNews({
        ...(category === "ALL" ? {} : { category }),
        limit: PAGE_SIZE,
        offset: articles.length
      });
      // Dedupe on canonical URL: the durable store can shift under a cursor
      // when the refresh job inserts newer stories mid-scroll.
      setArticles((current) => {
        const seen = new Set(current.map((item) => item.canonicalUrl));
        return [...current, ...page.articles.filter((item) => !seen.has(item.canonicalUrl))];
      });
      setTotal(page.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load more stories.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function openStory(story: HomeLiveUpdate) {
    try {
      await Linking.openURL(story.canonicalUrl);
    } catch {
      setError("This publisher link could not be opened.");
    }
  }

  const hasMore = articles.length < total;

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable style={s.back} onPress={() => router.back()} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color="#11152E" />
        </Pressable>
        <View style={s.headerCopy}>
          <Text style={s.eyebrow}>LINQA WORLD NEWS</Text>
          <Text style={s.title}>
            {category === "ALL"
              ? "Breaking around the world"
              : `${category.charAt(0)}${category.slice(1).toLowerCase()} stories`}
          </Text>
        </View>
        <View style={[s.status, articles.length === 0 && s.statusMuted]}>
          <View style={s.statusDot} />
          <Text style={s.statusText}>{articles.length > 0 ? "LIVE" : "NONE"}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(category)} colors={["#5B4CFF"]} />}
      >
        <Text style={s.disclosure}>
          Headlines open on the original publisher&rsquo;s website and are always shown with their source. Only
          publishers on Linqa&rsquo;s reviewed allowlist appear here.
        </Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          {CATEGORIES.map((option) => (
            <Pressable
              key={option}
              style={[s.chip, category === option && s.chipActive]}
              onPress={() => setCategory(option)}
            >
              <Text style={[s.chipText, category === option && s.chipTextActive]}>
                {option === "ALL" ? "All" : `${option.charAt(0)}${option.slice(1).toLowerCase()}`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {error ? (
          <Pressable style={s.error} onPress={() => load(category)}>
            <Text style={s.errorText}>{error} Tap to retry.</Text>
          </Pressable>
        ) : null}

        {loading && articles.length === 0 ? <ActivityIndicator color="#5B4CFF" style={{ marginTop: 80 }} /> : null}

        {!loading && articles.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="cloud-offline-outline" size={34} color="#667085" />
            <Text style={s.emptyTitle}>No verified stories available</Text>
            <Text style={s.emptyCopy}>
              Linqa does not show placeholder headlines. Pull down to check the news service again.
            </Text>
          </View>
        ) : null}

        {articles.map((story) => (
          <Pressable key={story.canonicalUrl} style={s.card} onPress={() => void openStory(story)}>
            {story.imageUrl ? (
              <Image source={{ uri: story.imageUrl }} style={s.image} />
            ) : (
              <View style={[s.image, s.imageFallback]}>
                <Ionicons name="newspaper-outline" size={28} color="#6B5CFF" />
              </View>
            )}
            <View style={s.body}>
              <View style={s.metaRow}>
                <Text style={s.category}>{story.category}</Text>
                <Text style={s.age}>{relativeAge(story.publishedAt)}</Text>
              </View>
              <Text style={s.storyTitle} numberOfLines={3}>{story.title}</Text>
              {story.breaking ? (
                <View style={s.breakingTag}><Text style={s.breakingTagText}>BREAKING</Text></View>
              ) : null}
              <View style={s.sourceRow}>
                {/* Publisher attribution is a licensing obligation, so it is
                    rendered on every card rather than on hover or detail. */}
                <Text style={s.source} numberOfLines={1}>{attributionFor(story)}</Text>
                <Ionicons name="open-outline" size={16} color="#667085" />
              </View>
            </View>
          </Pressable>
        ))}

        {hasMore ? (
          <Pressable style={s.loadMore} onPress={loadMore} disabled={loadingMore}>
            {loadingMore ? (
              <ActivityIndicator color="#4F46E5" />
            ) : (
              <Text style={s.loadMoreText}>Load more stories</Text>
            )}
          </Pressable>
        ) : null}

        {articles.length > 0 ? (
          <Text style={s.total}>
            Showing {articles.length} of {total} verified {total === 1 ? "story" : "stories"}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
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
  disclosure: { color: "#667085", fontSize: 12, lineHeight: 16, marginBottom: 12 },
  filterRow: { flexDirection: "row", gap: 7, marginBottom: 12 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E4E8F0" },
  chipActive: { backgroundColor: "#4F46E5", borderColor: "#4F46E5" },
  chipText: { color: "#475569", fontSize: 12.5, fontWeight: "800" },
  chipTextActive: { color: "#FFFFFF" },
  error: { padding: 11, backgroundColor: "#FEF3F2", borderRadius: 10, marginBottom: 10 },
  errorText: { color: "#B42318", fontSize: 12 },
  card: { flexDirection: "row", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E4E8F0", borderRadius: 16, padding: 10, marginBottom: 10, shadowColor: "#101828", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  image: { width: 92, minHeight: 92, borderRadius: 12 },
  imageFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "#F0EEFF" },
  body: { flex: 1, marginLeft: 11 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  category: { color: "#6B5CFF", fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  age: { color: "#98A2B3", fontSize: 9 },
  storyTitle: { color: "#101828", fontSize: 13, lineHeight: 17, fontWeight: "800", marginTop: 6 },
  breakingTag: { alignSelf: "flex-start", marginTop: 6, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: "#FEF3F2" },
  breakingTagText: { color: "#B42318", fontSize: 7.5, fontWeight: "900", letterSpacing: 0.5 },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: "auto" },
  source: { flex: 1, color: "#667085", fontSize: 9.5 },
  loadMore: { marginTop: 6, alignItems: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E4E8F0" },
  loadMoreText: { color: "#4F46E5", fontSize: 12, fontWeight: "800" },
  total: { color: "#98A2B3", fontSize: 12, textAlign: "center", marginTop: 10 },
  empty: { alignItems: "center", paddingTop: 90 },
  emptyTitle: { color: "#101828", fontSize: 17, fontWeight: "900", marginTop: 12 },
  emptyCopy: { color: "#667085", fontSize: 12, marginTop: 5, textAlign: "center", paddingHorizontal: 24, lineHeight: 17 }
});

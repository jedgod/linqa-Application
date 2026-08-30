import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { MobileHubService, type HomeFeed, type HomeNewsStory, type HubContact, type HubSnapshot } from "../../services/mobile-hub.service";
import { accessTokenProvider } from "../../services/session";
import { colors, radius, spacing } from "../../theme/tokens";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";

function formatRelative(epochMillis: number): string {
  if (!epochMillis) return "";
  const diffMs = Date.now() - epochMillis;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(epochMillis).toLocaleDateString();
}

/**
 * Real port of the Android `ConversationListScreen.kt` "Chats" hub — the
 * actual designed Home experience (header, welcome/status panel, people
 * rail, filter bar, real conversation list) against the same genuine
 * `/v1/dev/mobile-hub` Postgres-backed dev-preview surface Android's
 * `CoreBridge.loadHub()` already uses — not the generic catalog-driven
 * action list `ModuleRouteScreen` was rendering here before.
 */
export default function HomeScreen() {
  const router = useRouter();
  const client = useMemo(() => new MobileHubService(API, () => accessTokenProvider.getAccessToken()), []);
  const [hub, setHub] = useState<HubSnapshot | null>(null);
  const [homeFeed, setHomeFeed] = useState<HomeFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusModal, setStatusModal] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");
  const [composeModal, setComposeModal] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.allSettled([client.loadHub(), client.loadHomeFeed()])
      .then(([hubResult, feedResult]) => {
        const failures: string[] = [];
        if (hubResult.status === "fulfilled") setHub(hubResult.value);
        else failures.push(hubResult.reason instanceof Error ? hubResult.reason.message : "Unable to load your conversations.");
        if (feedResult.status === "fulfilled") setHomeFeed(feedResult.value);
        else failures.push(feedResult.reason instanceof Error ? feedResult.reason.message : "Unable to load your Home feed.");
        setError(failures.length ? failures.join(" ") : null);
      })
      .finally(() => setLoading(false));
  }, [client]);

  useEffect(load, [load]);

  const stories = homeFeed?.news.stories ?? [];
  const heroStory = stories.find((story) => story.imageUrl) ?? stories[0];
  const liveStories = stories.filter((story) => story.id !== heroStory?.id).slice(0, 3);
  const spotlightStory = stories.find((story) => story.category === "TECHNOLOGY" && story.id !== heroStory?.id) ?? stories[1];
  const worldStories = stories.filter((story) => story.id !== heroStory?.id && story.id !== spotlightStory?.id).slice(0, 3);
  const totalUnread = (hub?.conversations ?? []).reduce((sum, conversation) => sum + conversation.unreadCount, 0);

  async function openStory(story: HomeNewsStory | undefined) {
    if (!story) {
      router.push("/news");
      return;
    }
    try {
      await Linking.openURL(story.url);
    } catch {
      setError("This publisher link could not be opened.");
    }
  }

  async function submitStatus() {
    if (!statusDraft.trim()) return;
    try {
      await client.publishStatus(statusDraft.trim());
      setStatusDraft("");
      setStatusModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to post status.");
    }
  }

  async function startConversation(contact: HubContact) {
    try {
      await client.createConversation(contact.id);
      setComposeModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start that conversation.");
    }
  }

  const quickActions = [
    { key: "chat", label: "Chat", icon: "chatbubble-ellipses-outline", accent: "#E9ECFF", tint: "#4F46E5", onPress: () => setComposeModal(true) },
    { key: "call", label: "Call", icon: "call-outline", accent: "#EAF7F4", tint: "#1EAB7A", onPress: () => router.push("/(tabs)/calls") },
    { key: "send", label: "Send\nMoney", icon: "arrow-up-outline", accent: "#FFF0E9", tint: "#FF8A3D", onPress: () => router.push("/linqasend/index") },
    { key: "vault", label: "Save to\nVault", icon: "lock-closed-outline", accent: "#F3E8FF", tint: "#8B5CF6", onPress: () => router.push("/modules/file-vault") },
    { key: "event", label: "Event", icon: "calendar-outline", accent: "#EAF7F4", tint: "#14B8A6", onPress: () => router.push("/countrylinqa/create?type=event") },
    { key: "post", label: "Post", icon: "create-outline", accent: "#EAF3FF", tint: "#3B82F6", onPress: () => setStatusModal(true) },
    { key: "more", label: "More", icon: "ellipsis-horizontal", accent: "#F3F4F6", tint: "#64748B", onPress: () => router.push("/(tabs)/linqa") }
  ] as const;

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={s.screen}>
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#5B4CFF" colors={["#5B4CFF"]} />}
      >
        <View style={s.topRow}>
          <View style={s.brandWrap}>
            <View style={s.logoCircle}>
              <View style={s.logoInner} />
            </View>
            <Text style={s.wordmark}>LINQA</Text>
          </View>

          <View style={s.topActions}>
            <Pressable style={s.iconButton} onPress={() => router.push("/search")} accessibilityLabel="Search Linqa">
              <Ionicons name="search-outline" size={20} color="#0F172A" />
            </Pressable>
            <Pressable style={s.iconButton} onPress={() => router.push("/modules/ai")} accessibilityLabel="Ask Linqa AI">
              <Ionicons name="sparkles-outline" size={20} color="#0F172A" />
            </Pressable>
            <Pressable style={s.iconButton} onPress={() => router.push("/settings/notifications")} accessibilityLabel="Open notifications">
              <Ionicons name="notifications-outline" size={20} color="#0F172A" />
              {totalUnread > 0 ? <View style={s.notificationBadge}><Text style={s.notificationBadgeText}>{Math.min(totalUnread, 99)}</Text></View> : null}
            </Pressable>
            <Pressable style={s.avatarButton} onPress={() => router.push("/account/manage")} accessibilityLabel="Open profile">
              <View style={s.avatarMini}>
                <Text style={s.avatarMiniText}>{hub ? initialsOf(hub.profile.displayName) : "J"}</Text>
              </View>
              <View style={s.onlineDot} />
            </Pressable>
          </View>
        </View>

        <Text style={s.greeting}>{greeting()}, {hub?.profile.displayName.split(" ")[0] || "there"} <Text style={s.emoji}>👋</Text></Text>
        <Text style={s.subtitle}>Here's what's happening in your world today.</Text>

        <ImageBackground
          source={heroStory?.imageUrl ? { uri: heroStory.imageUrl } : undefined}
          style={s.heroCard}
          imageStyle={s.heroImage}
        >
          <LinearGradient colors={["rgba(3,7,28,0.98)", "rgba(3,7,28,0.82)", "rgba(3,7,28,0.12)"]} locations={[0, 0.56, 1]} style={s.heroGradient}>
            <View style={s.heroContent}>
              <View style={s.kickerRow}><Ionicons name="flash" size={13} color="#FF3B4E" /><Text style={s.heroKicker}>BREAKING NEWS</Text></View>
              <Text style={s.heroTitle} numberOfLines={3}>{heroStory?.title ?? (loading ? "Global news is refreshing" : "Global news is unavailable")}</Text>
              <Text style={s.heroCopy} numberOfLines={2}>
                {heroStory ? `${heroStory.source}${heroStory.sourceCountry ? ` · ${heroStory.sourceCountry}` : ""} · ${formatStoryAge(heroStory.publishedAt)}` : "No verified publisher story is available. Pull down or tap Retry."}
              </Text>
              <Pressable style={s.heroButton} onPress={() => heroStory ? void openStory(heroStory) : load()}>
                <Text style={s.heroButtonText}>{heroStory ? "Read Full Story" : "Retry"}</Text>
                <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
              </Pressable>
              <View style={s.dotRow}>
                <View style={s.dotActive} />
                <View style={s.dotInactive} />
                <View style={s.dotInactive} />
                <View style={s.dotInactive} />
              </View>
            </View>
            <View style={[s.livePill, homeFeed?.news.status !== "LIVE" && s.stalePill]}>
              <Text style={s.livePillText}>{homeFeed?.news.status ?? "SYNC"}</Text>
            </View>
          </LinearGradient>
        </ImageBackground>

        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>QUICK ACTIONS</Text>
          <Pressable onPress={() => router.push("/(tabs)/linqa")}><Text style={s.sectionLink}>Customize</Text></Pressable>
        </View>

        <View style={s.quickGrid}>
          {quickActions.map((item) => (
            <Pressable key={item.key} style={s.quickItem} onPress={item.onPress}>
              <View style={[s.quickIconWrap, { backgroundColor: item.accent }]}>
                <Ionicons name={item.icon as any} size={22} color={item.tint} />
              </View>
              <Text style={s.quickLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.updateRow}>
          <View style={s.liveHeading}><View style={s.liveDot} /><Text style={s.panelTitle}>LIVE UPDATES</Text></View>
          <Pressable onPress={() => router.push("/news")}><Text style={s.seeAll}>See all</Text></Pressable>
        </View>

        <View style={s.updateGrid}>
          <View style={s.listPanel}>
            {liveStories.map((item) => (
              <Pressable key={item.id} style={s.listItem} onPress={() => void openStory(item)}>
                {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={s.listThumb} /> : <View style={[s.listThumb, s.listThumbFallback]}><Ionicons name="newspaper-outline" size={18} color="#FFFFFF" /></View>}
                <View style={s.listBody}>
                  <Text style={s.listTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={s.listMeta} numberOfLines={1}>{item.source} · {formatStoryAge(item.publishedAt)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color="#667085" />
              </Pressable>
            ))}
            {liveStories.length === 0 ? <View style={s.feedUnavailable}><Ionicons name="cloud-offline-outline" size={20} color="#667085" /><Text style={s.feedUnavailableText}>Live updates are reconnecting.</Text></View> : null}
          </View>

          <ImageBackground source={spotlightStory?.imageUrl ? { uri: spotlightStory.imageUrl } : undefined} style={s.spotlightCard} imageStyle={s.spotlightImage}>
            <LinearGradient colors={["rgba(3,7,28,0.96)", "rgba(3,7,28,0.70)", "rgba(3,7,28,0.18)"]} style={s.spotlightGradient}>
              <View style={s.spotlightHeading}><Ionicons name="star" size={12} color="#FFC928" /><Text style={s.spotlightHeader}>SPOTLIGHT</Text></View>
              <View style={s.spotlightBottom}>
                <Text style={s.spotlightTitle} numberOfLines={3}>{spotlightStory?.title ?? "Spotlight is unavailable"}</Text>
                <Text style={s.spotlightText} numberOfLines={2}>{spotlightStory ? `${spotlightStory.source} · ${formatStoryAge(spotlightStory.publishedAt)}` : "Verified stories will appear here when the news service reconnects."}</Text>
                <Pressable style={s.primaryButton} onPress={() => spotlightStory ? void openStory(spotlightStory) : load()}><Text style={s.primaryButtonText}>{spotlightStory ? "Explore Now" : "Retry"}</Text></Pressable>
              </View>
            </LinearGradient>
          </ImageBackground>
        </View>

        <View style={s.sectionRow}>
          <Text style={s.panelTitle}>UPCOMING</Text>
          <Pressable onPress={() => router.push("/modules/calendar")}><Text style={s.seeAll}>See all</Text></Pressable>
        </View>

        <View style={s.upcomingRow}>
          {(homeFeed?.upcomingEvents ?? []).map((event) => {
            const date = new Date(event.startsAt);
            return (
            <Pressable key={event.id} style={s.eventCard} onPress={() => router.push("/countrylinqa/world")}>
              <View style={s.eventDate}>
                <Text style={s.eventMonth}>{date.toLocaleDateString(undefined, { month: "short" })}</Text>
                <Text style={s.eventDay}>{date.getDate()}</Text>
              </View>
              <View style={s.eventBody}>
                <Text style={s.eventTitle}>{event.title}</Text>
                <View style={s.eventMetaRow}><Ionicons name="time-outline" size={12} color="#64748B" /><Text style={s.eventMeta}>{date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</Text></View>
                <View style={s.eventMetaRow}><Ionicons name="globe-outline" size={12} color="#64748B" /><Text style={s.eventMeta}>{event.city ?? event.countryCode ?? "Online event"}</Text></View>
              </View>
            </Pressable>
          );})}
          {(homeFeed?.upcomingEvents.length ?? 0) === 0 ? (
            <Pressable style={[s.eventCard, s.emptyEventCard]} onPress={() => router.push("/countrylinqa/create?type=event")}>
              <View style={s.emptyEventIcon}><Ionicons name="add" size={20} color="#5B4CFF" /></View>
              <View style={s.eventBody}><Text style={s.eventTitle}>Plan your next event</Text><Text style={s.eventMeta}>Create a real CountryLinqa event</Text></View>
            </Pressable>
          ) : null}
        </View>

        <View style={s.sectionRowWide}>
          <Text style={s.panelTitle}>CONTINUE YOUR DAY</Text>
          <Pressable onPress={() => router.push("/(tabs)/chats")}><Text style={s.seeAll}>See all</Text></Pressable>
        </View>

        <View style={s.bottomSplit}>
          <Pressable
            style={s.continuePanel}
            onPress={() => router.push({ pathname: "/(tabs)/chats", params: hub?.conversations[0]?.id ? { conversationId: hub.conversations[0].id } : {} })}
            accessibilityRole="button"
          >
            <View style={s.personRow}>
              <View style={s.smallAvatar}>
                <Text style={s.smallAvatarText}>{initialsOf(hub?.conversations[0]?.title || "Chats")}</Text>
              </View>
              <View style={s.personMeta}>
                <Text style={s.personNameHuge}>{hub?.conversations[0]?.title || "Open your chats"}</Text>
                <Text style={s.personTime}>{hub?.conversations[0] ? formatRelative(hub.conversations[0].lastMessageAt) : ""}</Text>
              </View>
              <Ionicons name="ellipsis-horizontal" size={18} color="#475569" />
            </View>
            <Text style={s.messageText}>{hub?.conversations[0]?.lastMessagePreview || "Your recent conversations will appear here."}</Text>
            {(hub?.conversations[0]?.unreadCount ?? 0) > 0 ? <View style={s.messageBadge}><Text style={s.unreadBadgeText}>{hub?.conversations[0]?.unreadCount}</Text></View> : null}
          </Pressable>

          <View style={s.countryPanel}>
            <View style={s.countryHeader}>
              <Text style={s.countryTitle}>COUNTRYLINQA</Text>
              <Pressable onPress={() => router.push("/countrylinqa/world")}><Text style={s.seeAll}>See all</Text></Pressable>
            </View>
            <View style={s.countryMetaRow}>
              <View style={s.countryIdentity}><Text style={s.countryFlag}>{countryFlag(homeFeed?.country.code)}</Text><Text style={s.countryLabel}>{homeFeed?.country.name ?? "Your country"}</Text></View>
              <Pressable onPress={() => router.push("/settings/countrylinqa")}><Text style={s.countryChange}>Change</Text></Pressable>
            </View>
            <Text style={s.countrySmall}>Trending in live global coverage</Text>
            {(homeFeed?.trends ?? []).map((trend) => (
              <Pressable key={trend.title} style={s.countryTrend} onPress={() => router.push({ pathname: "/news", params: { category: trend.title } })}>
                <View style={s.trendRank}><Text style={s.trendRankText}>{trend.rank}</Text></View>
                <View style={s.trendBody}>
                  <Text style={s.trendTitle}>{humanizeCategory(trend.title)}</Text>
                  <Text style={s.trendValue}>{trend.storyCount} live {trend.storyCount === 1 ? "story" : "stories"}</Text>
                </View>
                <Ionicons name="trending-up" size={15} color="#22C55E" />
              </Pressable>
            ))}
          </View>
        </View>

        <View style={s.worldPanel}>
          <View style={s.worldRow}>
            <View style={s.worldHeading}><Ionicons name="earth" size={14} color="#FFC928" /><Text style={s.worldPanelTitle}>BREAKING AROUND THE WORLD</Text></View>
            <Pressable onPress={() => router.push("/news")}><Text style={s.worldSeeAll}>See all</Text></Pressable>
          </View>
          <View style={s.worldGrid}>
            {worldStories.map((item) => (
              <Pressable key={item.id} style={s.worldCard} onPress={() => void openStory(item)}>
                {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={s.worldImage} /> : <View style={[s.worldImage, s.worldImageFallback]}><Ionicons name="newspaper-outline" size={20} color="#7C6CFF" /></View>}
                <View style={s.worldBody}>
                  <Text style={s.worldTag}>{item.category}</Text>
                  <Text style={s.worldLabel} numberOfLines={3}>{item.title}</Text>
                  <Text style={s.worldTime}>{formatStoryAge(item.publishedAt)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
          <View style={s.worldDots}><View style={s.worldDotActive} /><View style={s.worldDot} /><View style={s.worldDot} /><View style={s.worldDot} /></View>
        </View>

        <View style={s.aiToolsRow}>
        <Pressable style={s.askRow} onPress={() => router.push("/modules/ai")} accessibilityRole="button">
          <View style={s.aiIconWrap}><Ionicons name="sparkles-outline" size={18} color="#FFFFFF" /></View>
          <View style={s.aiTextWrap}>
            <Text style={s.aiTitle}>Ask Linqa AI</Text>
            <Text style={s.aiSubtitle}>Summarize my unread messages</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#111827" />
        </Pressable>
          <Pressable style={s.aiToolButton} onPress={() => router.push({ pathname: "/modules/ai", params: { mode: "voice" } })}><Ionicons name="mic-outline" size={18} color="#5B4CFF" /><Text style={s.aiToolText}>Voice</Text></Pressable>
          <Pressable style={s.aiToolButton} onPress={() => router.push("/(tabs)/media")}><Ionicons name="camera-outline" size={18} color="#5B4CFF" /><Text style={s.aiToolText}>Camera</Text></Pressable>
        </View>

        {error ? <Pressable style={s.errorCard} onPress={load}><Ionicons name="warning-outline" size={18} color="#B42318" /><Text style={s.errorText}>{error} Tap to retry.</Text></Pressable> : null}

        {loading && (
          <View style={s.center}>
            <ActivityIndicator color={colors.accent} />
            <Text style={s.muted}>Refreshing your Linqa world</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={statusModal} transparent animationType="fade" onRequestClose={() => setStatusModal(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>My status</Text>
            <TextInput
              value={statusDraft}
              onChangeText={(t) => setStatusDraft(t.slice(0, 280))}
              placeholder="What are you working on?"
              placeholderTextColor={colors.textFaint}
              style={s.modalInput}
              multiline
            />
            <View style={s.modalActions}>
              <Pressable onPress={() => setStatusModal(false)}>
                <Text style={s.modalCancel}>Cancel</Text>
              </Pressable>
              <Pressable onPress={submitStatus} disabled={!statusDraft.trim()}>
                <Text style={[s.modalConfirm, !statusDraft.trim() && { opacity: 0.4 }]}>Post</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={composeModal} transparent animationType="fade" onRequestClose={() => setComposeModal(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>New conversation</Text>
            {(hub?.contacts ?? []).map((contact) => (
              <Pressable key={contact.id} style={s.contactRow} onPress={() => startConversation(contact)}>
                <Text style={s.contactRowText}>{contact.displayName}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setComposeModal(false)} style={{ marginTop: spacing.md }}>
              <Text style={s.modalCancel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join("")
    .toUpperCase();
}

function formatStoryAge(value: string): string {
  return formatRelative(new Date(value).getTime());
}

function humanizeCategory(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(...code.toUpperCase().split("").map((character) => 127397 + character.charCodeAt(0)));
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F6FB" },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 96 },
  statusBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  timeText: { color: "#0F172A", fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
  statusIcons: { flexDirection: "row", alignItems: "center", gap: 6 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  brandWrap: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#4F46E5",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#4F46E5",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }
  },
  logoInner: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: "#FFFFFF" },
  wordmark: { color: "#0F172A", fontSize: 26, fontWeight: "900", letterSpacing: -0.7 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 16,
    backgroundColor: "#EEF2F7",
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  notificationBadge: { position: "absolute", top: -5, right: -5, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 3, alignItems: "center", justifyContent: "center", backgroundColor: "#FF3B4E", borderWidth: 2, borderColor: "#F4F6FB" },
  notificationBadgeText: { color: "#FFFFFF", fontSize: 8, fontWeight: "900" },
  avatarButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", alignItems: "center", justifyContent: "center" },
  avatarMini: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F5D0FE",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarMiniText: { color: "#0F172A", fontSize: 10, fontWeight: "900" },
  onlineDot: { position: "absolute", right: -1, bottom: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: "#22C55E", borderWidth: 2, borderColor: "#FFFFFF" },
  greeting: { marginTop: 18, color: "#111827", fontSize: 20, fontWeight: "800", letterSpacing: -0.25 },
  emoji: { fontSize: 18 },
  subtitle: { color: "#475569", fontSize: 12.5, marginTop: 2 },
  heroCard: {
    marginTop: 14,
    height: 194,
    borderRadius: 18,
    backgroundColor: "#0F172A",
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "#1E293B",
    shadowColor: "#0F172A",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2
  },
  heroImage: { borderRadius: 18 },
  heroGradient: { flex: 1 },
  heroOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(10,14,28,0.30)"
  },
  heroContent: { flex: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  heroKicker: { color: "#FF4859", fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  heroTitle: { marginTop: 9, color: "#FFFFFF", fontSize: 19, fontWeight: "900", letterSpacing: -0.35, lineHeight: 23, maxWidth: "72%" },
  heroTitle2: { color: "#FFFFFF", fontSize: 18.5, fontWeight: "900", letterSpacing: -0.35, lineHeight: 22, marginTop: 0 },
  heroCopy: { marginTop: 6, color: "#E2E8F0", fontSize: 11.5, lineHeight: 15, maxWidth: 232 },
  heroButton: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#4F46E5",
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 6
  },
  heroButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 12 },
  dotRow: { position: "absolute", bottom: 10, left: "49%", flexDirection: "row", gap: 7 },
  dotActive: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  dotInactive: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.45)" },
  livePill: {
    position: "absolute",
    top: 16,
    right: 18,
    backgroundColor: "#F97316",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  livePillText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  stalePill: { backgroundColor: "#667085" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  sectionTitle: { color: "#111827", fontSize: 13, fontWeight: "900", letterSpacing: 0.12 },
  sectionLink: { color: "#475569", fontSize: 10.5, fontWeight: "700" },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 10, gap: 6 },
  quickItem: {
    width: "14%",
    minWidth: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8
  },
  quickIconWrap: { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  quickLabel: {
    marginTop: 5,
    color: "#111827",
    fontSize: 9.5,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 11,
    width: 54
  },
  updateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  liveHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FF3B4E" },
  panelTitle: { color: "#111827", fontSize: 13, fontWeight: "900", letterSpacing: 0.1 },
  seeAll: { color: "#475569", fontSize: 12, fontWeight: "700" },
  updateGrid: { flexDirection: "row", gap: 10, marginTop: 10 },
  listPanel: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: "#E2E8F0", padding: 8 },
  listItem: { flexDirection: "row", alignItems: "center", paddingVertical: 7, gap: 8 },
  listThumb: { width: 38, height: 38, borderRadius: 10 },
  listThumbFallback: { backgroundColor: "#5B4CFF", alignItems: "center", justifyContent: "center" },
  listBody: { flex: 1 },
  listTitle: { color: "#111827", fontSize: 11.5, fontWeight: "800" },
  listMeta: { color: "#64748B", fontSize: 10, marginTop: 3 },
  liveTag: { backgroundColor: "#EEF2FF", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3 },
  liveTagText: { color: "#4F46E5", fontSize: 8.5, fontWeight: "900" },
  feedUnavailable: { minHeight: 130, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 10 },
  feedUnavailableText: { color: "#667085", fontSize: 10.5, textAlign: "center" },
  spotlightCard: {
    flex: 1,
    backgroundColor: "#090C1A",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#111827",
    overflow: "hidden",
    minHeight: 178
  },
  spotlightImage: { borderRadius: 12 },
  spotlightGradient: { flex: 1, padding: 12, justifyContent: "space-between" },
  spotlightHeading: { flexDirection: "row", alignItems: "center", gap: 5 },
  spotlightBottom: { marginTop: 22 },
  spotlightHeader: { color: "#E2E8F0", fontSize: 9.5, fontWeight: "800", letterSpacing: 0.2 },
  spotlightTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", lineHeight: 22, marginTop: 10 },
  spotlightText: { color: "#DDE6F4", fontSize: 12, lineHeight: 17, marginTop: 7 },
  primaryButton: {
    marginTop: 12,
    backgroundColor: "#4F46E5",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "900" },
  peopleStack: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  avatarStack: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#22C55E",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#090C1A"
  },
  avatarText: { color: "#FFFFFF", fontSize: 8, fontWeight: "900" },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  upcomingRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  eventCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 8,
    flexDirection: "row",
    gap: 8
  },
  eventDate: { width: 42, alignItems: "center" },
  eventMonth: { color: "#64748B", fontSize: 8.5, fontWeight: "800", textTransform: "uppercase" },
  eventDay: { color: "#111827", fontSize: 22, fontWeight: "900", marginTop: 2 },
  eventBody: { flex: 1 },
  eventTitle: { color: "#111827", fontSize: 11.5, fontWeight: "800", lineHeight: 15 },
  eventMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  eventMeta: { color: "#64748B", fontSize: 10 },
  emptyEventCard: { minHeight: 86, alignItems: "center" },
  emptyEventIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#F0EEFF" },
  sectionRowWide: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  bottomSplit: { flexDirection: "row", gap: 10, marginTop: 10 },
  continuePanel: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 10,
    position: "relative"
  },
  personRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  smallAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F5D0FE", alignItems: "center", justifyContent: "center" },
  smallAvatarText: { color: "#111827", fontWeight: "800", fontSize: 10 },
  personMeta: { flex: 1 },
  personNameHuge: { color: "#111827", fontWeight: "800", fontSize: 12 },
  personTime: { color: "#64748B", fontSize: 9.5 },
  messageText: { color: "#475569", fontSize: 12, marginTop: 8 },
  messageBadge: {
    position: "absolute",
    right: 12,
    bottom: 12,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#4F46E5",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6
  },
  countryPanel: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 10
  },
  countryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  countryTitle: { color: "#111827", fontWeight: "900", fontSize: 11.5 },
  countryMetaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  countryIdentity: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  countryFlag: { fontSize: 15 },
  countryLabel: { color: "#111827", fontWeight: "800", fontSize: 11.5 },
  countryChange: { color: "#4F46E5", fontWeight: "700", fontSize: 10.5 },
  countrySmall: { color: "#64748B", fontSize: 10, marginTop: 8 },
  countryTrend: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  trendRank: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" },
  trendRankText: { color: "#4F46E5", fontSize: 9, fontWeight: "900" },
  trendBody: { flex: 1 },
  trendTitle: { color: "#111827", fontSize: 11, fontWeight: "700" },
  trendValue: { color: "#64748B", fontSize: 9, marginTop: 2 },
  trendUp: { color: "#22C55E", fontSize: 15, fontWeight: "900" },
  worldPanel: { marginTop: 18, backgroundColor: "#071028", borderRadius: 15, padding: 11, overflow: "hidden" },
  worldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  worldHeading: { flexDirection: "row", alignItems: "center", gap: 6 },
  worldPanelTitle: { color: "#FFFFFF", fontSize: 10.5, fontWeight: "900", letterSpacing: 0.1 },
  worldSeeAll: { color: "#C9D2E3", fontSize: 10.5, fontWeight: "700" },
  worldGrid: { flexDirection: "row", gap: 7, marginTop: 10 },
  worldCard: {
    flex: 1,
    minHeight: 112,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)"
  },
  worldImage: { width: "100%", height: 45 },
  worldImageFallback: { backgroundColor: "#141A38", alignItems: "center", justifyContent: "center" },
  worldBody: { padding: 7, flex: 1 },
  worldTag: { color: "#B89CFF", fontSize: 6.8, fontWeight: "900", letterSpacing: 0.5 },
  worldLabel: { color: "#FFFFFF", fontSize: 9.5, fontWeight: "800", marginTop: 4, lineHeight: 12 },
  worldTime: { color: "#AEB9CC", fontSize: 8, marginTop: 4 },
  worldDots: { marginTop: 9, flexDirection: "row", justifyContent: "center", gap: 5 },
  worldDotActive: { width: 17, height: 4, borderRadius: 2, backgroundColor: "#6C55FF" },
  worldDot: { width: 6, height: 4, borderRadius: 2, backgroundColor: "#536078" },
  aiToolsRow: { flexDirection: "row", alignItems: "stretch", gap: 7, marginTop: 12 },
  askRow: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  aiIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#4F46E5", alignItems: "center", justifyContent: "center" },
  aiTextWrap: { flex: 1 },
  aiTitle: { color: "#111827", fontWeight: "900", fontSize: 12.5 },
  aiSubtitle: { color: "#64748B", fontSize: 11, marginTop: 2 },
  aiToolButton: { minWidth: 58, borderRadius: 14, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", paddingHorizontal: 6, gap: 3 },
  aiToolText: { color: "#5B4CFF", fontSize: 9.5, fontWeight: "800" },
  errorCard: { marginTop: 12, borderRadius: 12, padding: 10, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA", flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { color: "#B42318", fontSize: 10.5, flex: 1 },
  toolbarRow: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3
  },
  bottomItem: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 8 },
  bottomItemActive: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: 12 },
  bottomLabel: { color: "#475569", fontSize: 10, fontWeight: "700", marginTop: 4 },
  bottomLabelActive: { color: "#4F46E5", fontSize: 10, fontWeight: "800", marginTop: 4 },
  centerFab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#4F46E5",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 8,
    shadowColor: "#4F46E5",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4
  },
  searchInput: {
    marginTop: spacing.md,
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.text
  },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xl, gap: spacing.sm },
  muted: { color: colors.textFaint, fontSize: 12 },
  emptyCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.xs
  },
  emptyTitle: { color: colors.text, fontWeight: "800" },
  conversationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md
  },
  convAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  convAvatarText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  convTitle: { color: colors.text, fontWeight: "800", fontSize: 14, flexShrink: 1, marginRight: 4 },
  convPreview: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  convTime: { color: colors.textFaint, fontSize: 10 },
  unreadBadge: {
    marginTop: 6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5
  },
  unreadBadgeText: { color: colors.onAccent, fontWeight: "900", fontSize: 10 },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: "900", marginBottom: spacing.md },
  modalInput: {
    minHeight: 70,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    padding: spacing.md,
    textAlignVertical: "top"
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.lg, marginTop: spacing.md },
  modalCancel: { color: colors.textMuted, fontWeight: "700" },
  modalConfirm: { color: colors.accent, fontWeight: "900" },
  contactRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  contactRowText: { color: colors.text, fontSize: 14 }
});

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { MobileHubService, type HubContact, type HubConversation, type HubSnapshot } from "../../services/mobile-hub.service";
import { colors, radius, spacing } from "../../theme/tokens";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8080";

type Filter = "ALL" | "UNREAD" | "GROUPS" | "PINNED";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "UNREAD", label: "Unread" },
  { key: "GROUPS", label: "Groups" },
  { key: "PINNED", label: "Pinned" }
];

function hueColor(hue: number, alpha = 1): string {
  return `hsla(${hue}, 62%, 50%, ${alpha})`;
}

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
  const client = useMemo(() => new MobileHubService(API), []);
  const [hub, setHub] = useState<HubSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [statusModal, setStatusModal] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");
  const [composeModal, setComposeModal] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    client
      .loadHub()
      .then(setHub)
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load your hub."))
      .finally(() => setLoading(false));
  }, [client]);

  useEffect(load, [load]);

  const conversations = hub?.conversations ?? [];
  const filtered = useMemo(() => {
    return conversations
      .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
      .filter((c) => {
        if (filter === "UNREAD") return c.unreadCount > 0;
        if (filter === "GROUPS") return c.isGroup;
        if (filter === "PINNED") return c.pinned;
        return true;
      })
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.lastMessageAt - a.lastMessageAt);
  }, [conversations, query, filter]);

  const counts: Record<Filter, number> = {
    ALL: conversations.length,
    UNREAD: conversations.filter((c) => c.unreadCount > 0).length,
    GROUPS: conversations.filter((c) => c.isGroup).length,
    PINNED: conversations.filter((c) => c.pinned).length
  };

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
    { key: "event", label: "Event", icon: "calendar-outline", accent: "#EAF7F4", tint: "#14B8A6", onPress: () => router.push("/countrylinqa/full-flow") },
    { key: "post", label: "Post", icon: "create-outline", accent: "#EAF3FF", tint: "#3B82F6", onPress: () => setStatusModal(true) },
    { key: "more", label: "More", icon: "ellipsis-horizontal", accent: "#F3F4F6", tint: "#64748B", onPress: () => router.push("/(tabs)/home") }
  ] as const;

  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.statusBar}>
          <Text style={s.timeText}>9:41</Text>
          <View style={s.statusIcons}>
            <Ionicons name="cellular" size={15} color="#111827" />
            <Ionicons name="wifi" size={15} color="#111827" />
            <Ionicons name="battery-full" size={18} color="#111827" />
          </View>
        </View>

        <View style={s.topRow}>
          <View style={s.brandWrap}>
            <View style={s.logoCircle}>
              <View style={s.logoInner} />
            </View>
            <Text style={s.wordmark}>LINQA</Text>
          </View>

          <View style={s.topActions}>
            <Pressable style={s.iconButton} onPress={() => setSearchVisible((v) => !v)} accessibilityLabel="Search conversations">
              <Ionicons name="search-outline" size={20} color="#0F172A" />
            </Pressable>
            <Pressable style={s.iconButton} onPress={() => router.push("/(tabs)/settings")} accessibilityLabel="Open settings">
              <Ionicons name="notifications-outline" size={20} color="#0F172A" />
            </Pressable>
            <Pressable style={s.avatarButton} onPress={() => setComposeModal(true)} accessibilityLabel="Open profile">
              <View style={s.avatarMini}>
                <Text style={s.avatarMiniText}>{hub ? initialsOf(hub.profile.displayName) : "J"}</Text>
              </View>
            </Pressable>
          </View>
        </View>

        <Text style={s.greeting}>Good morning, Jerry <Text style={s.emoji}>☀️</Text></Text>
        <Text style={s.subtitle}>Here's what's happening in your world today.</Text>

        <View style={s.heroCard}>
          <View style={s.heroOverlay} />
          <View style={s.heroContent}>
            <Text style={s.heroKicker}>BREAKING NEWS</Text>
            <Text style={s.heroTitle}>Global Tech Summit 2026</Text>
            <Text style={s.heroTitle2}>announced in New York</Text>
            <Text style={s.heroCopy}>Leaders, innovators and communities from 120+ countries expected to attend.</Text>
            <Pressable style={s.heroButton} onPress={() => router.push("/countrylinqa/world")}>
              <Text style={s.heroButtonText}>Read Full Story</Text>
              <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
            </Pressable>
            <View style={s.dotRow}>
              <View style={s.dotActive} />
              <View style={s.dotInactive} />
              <View style={s.dotInactive} />
            </View>
          </View>
          <View style={s.livePill}>
            <Text style={s.livePillText}>LIVE</Text>
          </View>
        </View>

        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>QUICK ACTIONS</Text>
          <Text style={s.sectionLink}>Customize</Text>
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
          <Text style={s.panelTitle}>LIVE UPDATES</Text>
          <Text style={s.seeAll}>See all</Text>
        </View>

        <View style={s.updateGrid}>
          <View style={s.listPanel}>
            {[
              { title: "Climate Action Now", meta: "Global Community • 2.3K watching", tag: "LIVE", accent: "#0EA5E9" },
              { title: "SpaceX Starship Launch", meta: "Science & Tech • Starting in 1h", tag: "LIVE", accent: "#7C3AED" },
              { title: "Champions League", meta: "Semi-final • Real Madrid vs Bayern", tag: "LIVE", accent: "#EC4899" }
            ].map((item) => (
              <View key={item.title} style={s.listItem}>
                <View style={[s.listThumb, { backgroundColor: item.accent }]} />
                <View style={s.listBody}>
                  <Text style={s.listTitle}>{item.title}</Text>
                  <Text style={s.listMeta}>{item.meta}</Text>
                </View>
                <View style={s.liveTag}><Text style={s.liveTagText}>{item.tag}</Text></View>
              </View>
            ))}
          </View>

          <View style={s.spotlightCard}>
            <Text style={s.spotlightHeader}>SPOTLIGHT</Text>
            <Text style={s.spotlightTitle}>AI is changing our future.</Text>
            <Text style={s.spotlightText}>Join communities, share ideas and shape tomorrow.</Text>
            <Pressable style={s.primaryButton} onPress={() => router.push("/countrylinqa/world")}>
              <Text style={s.primaryButtonText}>Explore Now</Text>
            </Pressable>
            <View style={s.peopleStack}>
              <View style={s.avatarStack}><Text style={s.avatarText}>A</Text></View>
              <View style={[s.avatarStack, { marginLeft: -8, backgroundColor: "#8B5CF6" }]}><Text style={s.avatarText}>M</Text></View>
              <View style={[s.avatarStack, { marginLeft: -8, backgroundColor: "#F59E0B" }]}><Text style={s.avatarText}>+24</Text></View>
            </View>
          </View>
        </View>

        <View style={s.sectionRow}>
          <Text style={s.panelTitle}>UPCOMING</Text>
          <Text style={s.seeAll}>See all</Text>
        </View>

        <View style={s.upcomingRow}>
          {[
            { day: "20", month: "MAY", time: "10:30 AM", title: "Design Review Meeting", type: "Video Call" },
            { day: "20", month: "MAY", time: "2:00 PM", title: "Community Event: AI & You", type: "Online Event" },
            { day: "21", month: "MAY", time: "6:00 PM", title: "Product Team Standup", type: "Google Meet" }
          ].map((event) => (
            <View key={event.title} style={s.eventCard}>
              <View style={s.eventDate}>
                <Text style={s.eventMonth}>{event.month}</Text>
                <Text style={s.eventDay}>{event.day}</Text>
              </View>
              <View style={s.eventBody}>
                <Text style={s.eventTitle}>{event.title}</Text>
                <View style={s.eventMetaRow}><Ionicons name="time-outline" size={12} color="#64748B" /><Text style={s.eventMeta}>{event.time}</Text></View>
                <View style={s.eventMetaRow}><Ionicons name="videocam-outline" size={12} color="#64748B" /><Text style={s.eventMeta}>{event.type}</Text></View>
              </View>
            </View>
          ))}
        </View>

        <View style={s.sectionRowWide}>
          <Text style={s.panelTitle}>CONTINUE YOUR DAY</Text>
          <Text style={s.seeAll}>See all</Text>
        </View>

        <View style={s.bottomSplit}>
          <View style={s.continuePanel}>
            <View style={s.personRow}>
              <View style={s.smallAvatar}>
                <Text style={s.smallAvatarText}>SJ</Text>
              </View>
              <View style={s.personMeta}>
                <Text style={s.personNameHuge}>Sarah Johnson</Text>
                <Text style={s.personTime}>9:30 AM</Text>
              </View>
              <Ionicons name="ellipsis-horizontal" size={18} color="#475569" />
            </View>
            <Text style={s.messageText}>Hey! Can you share the presentation?</Text>
            <View style={s.messageBadge}>2</View>
          </View>

          <View style={s.countryPanel}>
            <View style={s.countryHeader}>
              <Text style={s.countryTitle}>COUNTRYLINQA</Text>
              <Text style={s.seeAll}>See all</Text>
            </View>
            <View style={s.countryMetaRow}>
              <Text style={s.countryLabel}>United States</Text>
              <Text style={s.countryChange}>Change</Text>
            </View>
            <Text style={s.countrySmall}>Trending in your country</Text>
            {[
              ["AI regulation debate", "12.5K posts", true],
              ["Small business growth", "8.7K posts", true],
              ["Renewable energy jobs", "5.2K posts", true]
            ].map(([title, value, up]) => (
              <View key={title as string} style={s.countryTrend}>
                <View style={s.trendRank}><Text style={s.trendRankText}>{["1", "2", "3"][0] ?? "1"}</Text></View>
                <View style={s.trendBody}>
                  <Text style={s.trendTitle}>{title as string}</Text>
                  <Text style={s.trendValue}>{value as string}</Text>
                </View>
                <Text style={s.trendUp}>{up ? "↗" : "↘"}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.worldRow}>
          <Text style={s.panelTitle}>BREAKING AROUND THE WORLD</Text>
          <Text style={s.seeAll}>See all</Text>
        </View>

        <View style={s.worldGrid}>
          {[
            { label: "New economic policy approved by senate", tag: "POLITICS", time: "12m ago", tone: "#1E293B" },
            { label: "New AI model outperforms human experts", tag: "TECHNOLOGY", time: "25m ago", tone: "#0F172A" },
            { label: "WHO declares new health initiative", tag: "HEALTH", time: "37m ago", tone: "#1E3A8A" }
          ].map((item) => (
            <View key={item.label} style={[s.worldCard, { backgroundColor: item.tone }]}>
              <Text style={s.worldTag}>{item.tag}</Text>
              <Text style={s.worldLabel}>{item.label}</Text>
              <Text style={s.worldTime}>{item.time}</Text>
            </View>
          ))}
        </View>

        <View style={s.askRow}>
          <View style={s.aiIconWrap}><Ionicons name="sparkles-outline" size={18} color="#FFFFFF" /></View>
          <View style={s.aiTextWrap}>
            <Text style={s.aiTitle}>Ask Linqa AI</Text>
            <Text style={s.aiSubtitle}>Summarize my unread messages</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#111827" />
        </View>

        <View style={s.toolbarRow}>
          <Pressable style={s.bottomItemActive} onPress={() => router.push("/(tabs)/home")}>
            <Ionicons name="home" size={22} color="#4F46E5" />
            <Text style={s.bottomLabelActive}>Home</Text>
          </Pressable>
          <Pressable style={s.bottomItem} onPress={() => router.push("/(tabs)/calls")}>
            <Ionicons name="call-outline" size={22} color="#475569" />
            <Text style={s.bottomLabel}>Calls</Text>
          </Pressable>
          <Pressable style={s.centerFab} onPress={() => setComposeModal(true)}>
            <Ionicons name="add" size={28} color="#FFFFFF" />
          </Pressable>
          <Pressable style={s.bottomItem} onPress={() => router.push("/(tabs)/chats")}>
            <Ionicons name="chatbubble-outline" size={22} color="#475569" />
            <Text style={s.bottomLabel}>Chats</Text>
          </Pressable>
          <Pressable style={s.bottomItem} onPress={() => router.push("/countrylinqa/world")}>
            <Ionicons name="globe-outline" size={22} color="#475569" />
            <Text style={s.bottomLabel}>Linqa</Text>
          </Pressable>
        </View>

        {searchVisible && (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search people and conversations"
            placeholderTextColor={colors.textFaint}
            style={s.searchInput}
          />
        )}

        {loading && (
          <View style={s.center}>
            <ActivityIndicator color={colors.accent} />
            <Text style={s.muted}>Loading your conversations</Text>
          </View>
        )}

        {!loading && filtered.length === 0 && (
          <Pressable style={s.emptyCard} onPress={() => { setQuery(""); setFilter("ALL"); }}>
            <Ionicons name="chatbubble-outline" size={26} color={colors.accent} />
            <Text style={s.emptyTitle}>{query ? "No matching conversations" : "Nothing here yet"}</Text>
            <Text style={s.muted}>Tap to show every conversation</Text>
          </Pressable>
        )}

        {!loading && filtered.map((conversation) => (
          <Pressable key={conversation.id} style={s.conversationRow} onPress={() => router.push({ pathname: "/(tabs)/chats", params: { conversationId: conversation.id } })}>
            <View style={[s.convAvatar, { backgroundColor: hueColor(hashHue(conversation.title)) }]}>
              <Text style={s.convAvatarText}>{initialsOf(conversation.title)}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={s.convTitle} numberOfLines={1}>{conversation.title}</Text>
                {conversation.muted && <Ionicons name="volume-mute-outline" size={13} color={colors.textFaint} />}
                {conversation.pinned && <Ionicons name="pin" size={13} color={colors.accent} style={{ marginLeft: 4 }} />}
              </View>
              <Text style={s.convPreview} numberOfLines={1}>{conversation.lastMessagePreview}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.convTime, conversation.unreadCount > 0 && { color: colors.accent }]}>{formatRelative(conversation.lastMessageAt)}</Text>
              {conversation.unreadCount > 0 && (
                <View style={s.unreadBadge}>
                  <Text style={s.unreadBadgeText}>{conversation.unreadCount}</Text>
                </View>
              )}
            </View>
          </Pressable>
        ))}
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

function hashHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
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
    justifyContent: "center"
  },
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
  heroOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(10,14,28,0.30)"
  },
  heroContent: { position: "absolute", inset: 0, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12 },
  heroKicker: { color: "#F8FAFC", fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  heroTitle: { marginTop: 8, color: "#FFFFFF", fontSize: 18.5, fontWeight: "900", letterSpacing: -0.35, lineHeight: 22 },
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
  dotRow: { position: "absolute", bottom: 12, left: 18, flexDirection: "row", gap: 8 },
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
  panelTitle: { color: "#111827", fontSize: 13, fontWeight: "900", letterSpacing: 0.1 },
  seeAll: { color: "#475569", fontSize: 12, fontWeight: "700" },
  updateGrid: { flexDirection: "row", gap: 10, marginTop: 10 },
  listPanel: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: "#E2E8F0", padding: 8 },
  listItem: { flexDirection: "row", alignItems: "center", paddingVertical: 7, gap: 8 },
  listThumb: { width: 38, height: 38, borderRadius: 10 },
  listBody: { flex: 1 },
  listTitle: { color: "#111827", fontSize: 11.5, fontWeight: "800" },
  listMeta: { color: "#64748B", fontSize: 10, marginTop: 3 },
  liveTag: { backgroundColor: "#EEF2FF", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 3 },
  liveTagText: { color: "#4F46E5", fontSize: 8.5, fontWeight: "900" },
  spotlightCard: {
    flex: 1,
    backgroundColor: "#090C1A",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#111827",
    padding: 12,
    justifyContent: "space-between",
    overflow: "hidden"
  },
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
  worldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  worldGrid: { flexDirection: "row", gap: 8, marginTop: 10 },
  worldCard: {
    flex: 1,
    minHeight: 104,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 10,
    justifyContent: "flex-end"
  },
  worldTag: { color: "#E2E8F0", fontSize: 7.5, fontWeight: "800", letterSpacing: 0.6 },
  worldLabel: { color: "#FFFFFF", fontSize: 11.5, fontWeight: "800", marginTop: 8, lineHeight: 15 },
  worldTime: { color: "#E2E8F0", fontSize: 9.5, marginTop: 5 },
  askRow: {
    marginTop: 18,
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

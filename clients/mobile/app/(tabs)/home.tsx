import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { MobileHubService, type HubContact, type HubSnapshot } from "../../services/mobile-hub.service";
import {
  HIDEABLE_HOME_SECTIONS,
  HomeFeedService,
  JurisdictionRequiredError,
  attributionFor,
  newsStateLabel,
  relativeAge,
  type HideableHomeSection,
  type HomeFeedPayload,
  type HomeNewsItem,
  type HomePendingTransfer,
  type HomeUpcomingEvent,
  type HomeVaultItem
} from "../../services/home-feed.service";
import { accessTokenProvider } from "../../services/session";
import { colors, fonts, radius, spacing } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";

const API = getApiBaseUrl();

/** Horizontal page padding of the scroll content, both sides. */
const GUTTER = 18;
/** Stories carried by the hero pager, one per dot. */
const HERO_SLOTS = 4;
/** World cards per page, and pages, in "Breaking around the world". */
const WORLD_PER_PAGE = 3;
const WORLD_PAGES = 5;

const SECTION_LABELS: Record<HideableHomeSection, string> = {
  liveUpdates: "Live updates",
  spotlight: "Spotlight",
  upcoming: "Upcoming events",
  continueYourDay: "Continue your day",
  countryLinqa: "CountryLinqa",
  breakingAroundWorld: "Breaking around the world"
};

const DEGRADED_LABELS: Record<string, string> = {
  profile: "your profile",
  notifications: "your unread counts",
  countryLinqa: "CountryLinqa",
  upcoming: "upcoming events",
  continueYourDay: "your conversations",
  vault: "your Vault",
  transfers: "money in flight",
  liveUpdates: "live updates",
  spotlight: "spotlight",
  news: "world news",
  snapshot: "activity history"
};

/**
 * Vault items arrive without a name: `vault_items.name_ciphertext` is
 * encrypted with a key the server never holds. The card is therefore labelled
 * from the item type, which is the one unencrypted fact about it.
 */
const VAULT_LABELS: Record<HomeVaultItem["itemType"], string> = {
  DOCUMENT: "Encrypted document",
  IDENTITY: "Identity item",
  PHOTO: "Encrypted photo",
  RECOVERY: "Recovery item",
  OTHER: "Encrypted item"
};

const VAULT_ICONS: Record<HomeVaultItem["itemType"], { icon: string; tint: string; accent: string }> = {
  DOCUMENT: { icon: "document-text", tint: "#E23A3A", accent: "#FEECEC" },
  IDENTITY: { icon: "id-card", tint: "#2563EB", accent: "#E8EDFF" },
  PHOTO: { icon: "image", tint: "#8B5CF6", accent: "#F3E8FF" },
  RECOVERY: { icon: "key", tint: "#F59E0B", accent: "#FEF3C7" },
  OTHER: { icon: "lock-closed", tint: "#475569", accent: "#EEF2F7" }
};

/** Category accents for the world rail, keyed to `HOME_NEWS_CATEGORIES`. */
const CATEGORY_COLORS: Record<string, string> = {
  WORLD: "#6366F1",
  POLITICS: "#F43F5E",
  TECHNOLOGY: "#8B5CF6",
  HEALTH: "#22C55E",
  CLIMATE: "#14B8A6",
  BUSINESS: "#F59E0B",
  SCIENCE: "#06B6D4",
  SPORTS: "#3B82F6",
  GENERAL: "#94A3B8"
};

/**
 * Linqa Home, against the aggregated production Home API
 * (`GET /v1/mobile/home`).
 *
 * Two rules drive this screen:
 *
 * 1. Never invent content. Every headline comes from a validated, allowlisted
 *    publisher and is rendered with its attribution. When the news service is
 *    stale or unavailable the screen says exactly that, with the publisher
 *    state visible, instead of showing a blank or a stand-in story.
 *
 * 2. Never blank the whole screen for one failure. The server reports which
 *    sections degraded; each one renders its own honest empty state while the
 *    rest of Home carries on.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const homeClient = useMemo(
    () => new HomeFeedService(API, () => accessTokenProvider.getAccessToken()),
    []
  );
  const hubClient = useMemo(
    () => new MobileHubService(API, () => accessTokenProvider.getAccessToken()),
    []
  );

  const [feed, setFeed] = useState<HomeFeedPayload | null>(null);
  const [hub, setHub] = useState<HubSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jurisdictionRequired, setJurisdictionRequired] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");
  const [composeModal, setComposeModal] = useState(false);
  const [customizeModal, setCustomizeModal] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [heroPage, setHeroPage] = useState(0);
  const [worldPage, setWorldPage] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    // The Home feed and the hub snapshot are independent: the hub only backs
    // the compose sheet, so a hub failure must not stop Home rendering.
    Promise.allSettled([homeClient.loadFeed(), hubClient.loadHub()])
      .then(([feedResult, hubResult]) => {
        if (feedResult.status === "fulfilled") {
          setFeed(feedResult.value);
          setJurisdictionRequired(false);
          setError(null);
        } else if (feedResult.reason instanceof JurisdictionRequiredError) {
          setJurisdictionRequired(true);
          setError(null);
        } else {
          setError(
            feedResult.reason instanceof Error
              ? feedResult.reason.message
              : "Unable to load your Home feed."
          );
        }
        if (hubResult.status === "fulfilled") setHub(hubResult.value);
      })
      .finally(() => setLoading(false));
  }, [homeClient, hubClient]);

  useEffect(load, [load]);

  const newsState = feed?.serviceState.news;
  const stateCopy = newsStateLabel(newsState);
  const hiddenSections = new Set(feed?.serviceState.hiddenSections ?? []);
  const degraded = feed?.serviceState.degraded ?? [];

  // Card geometry. The hero and the world rail page one full card at a time,
  // so their slide width has to be the exact content width.
  const cardWidth = width - GUTTER * 2;
  const worldCardWidth = cardWidth - 22;

  const stories = feed?.breakingAroundWorld ?? [];
  // The hero is image-led, so image-bearing stories are promoted into it, but
  // a text-only story is still shown rather than leaving a slot empty.
  const heroStories = [
    ...stories.filter((story) => story.imageUrl),
    ...stories.filter((story) => !story.imageUrl)
  ].slice(0, HERO_SLOTS);
  const heroUrls = new Set(heroStories.map((story) => story.canonicalUrl));
  const worldStories = stories
    .filter((story) => !heroUrls.has(story.canonicalUrl))
    .slice(0, WORLD_PER_PAGE * WORLD_PAGES);
  const worldPagesOfStories = chunk(worldStories, WORLD_PER_PAGE);

  const liveUpdates = feed?.liveUpdates ?? [];
  const spotlightStory = feed?.spotlight ?? null;

  const notifications = feed?.notifications;
  const badgeCount = notifications?.total ?? 0;
  const firstName = feed?.profile?.displayName?.split(" ")[0] ?? "there";
  const conversations = (feed?.continueYourDay ?? []).slice(0, 3);
  const vaultItems = (feed?.vaultRecent ?? []).slice(0, 2);
  const transfers = (feed?.pendingTransfers ?? []).slice(0, 2);
  const hasContinueCards = conversations.length + vaultItems.length + transfers.length > 0;
  const countryPanel = feed?.countryLinqa;
  const upcoming = (feed?.upcoming ?? []).slice(0, 3);

  async function openLink(url: string | undefined) {
    if (!url) {
      router.push("/news");
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      setError("This publisher link could not be opened.");
    }
  }

  async function submitStatus() {
    if (!statusDraft.trim()) return;
    try {
      await hubClient.publishStatus(statusDraft.trim());
      setStatusDraft("");
      setStatusModal(false);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to post status.");
    }
  }

  async function startConversation(contact: HubContact) {
    try {
      await hubClient.createConversation(contact.id);
      setComposeModal(false);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start that conversation.");
    }
  }

  async function toggleSection(section: HideableHomeSection, visible: boolean) {
    const next = new Set(hiddenSections);
    if (visible) next.delete(section);
    else next.add(section);
    setSavingPreferences(true);
    try {
      await homeClient.savePreferences({ hiddenSections: [...next] as HideableHomeSection[] });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save your Home layout.");
    } finally {
      setSavingPreferences(false);
    }
  }

  async function togglePersonalization(enabled: boolean) {
    setSavingPreferences(true);
    try {
      await homeClient.savePreferences({ personalizationEnabled: enabled });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save your Home layout.");
    } finally {
      setSavingPreferences(false);
    }
  }

  const quickActions = [
    {
      key: "chat",
      label: "Chat",
      icon: "chatbubble-ellipses",
      accent: "#EDEBFF",
      tint: "#5B4CFF",
      // Conversations waiting, not messages waiting: the tile is a shortcut to
      // "how many threads need me", which is what the Chats tab total is not.
      badge: notifications?.unreadConversations ?? 0,
      onPress: () => setComposeModal(true)
    },
    {
      key: "call",
      label: "Call",
      icon: "call",
      accent: "#E4F7EE",
      tint: "#16A46A",
      badge: 0,
      onPress: () => router.push("/(tabs)/calls")
    },
    {
      key: "send",
      label: "Send\nMoney",
      icon: "paper-plane",
      accent: "#FFF0E6",
      tint: "#FF7A29",
      badge: 0,
      onPress: () => router.push("/linqasend/index")
    },
    {
      key: "vault",
      label: "Save to\nVault",
      icon: "lock-closed",
      accent: "#E8EDFF",
      tint: "#2563EB",
      badge: 0,
      onPress: () => router.push("/modules/file-vault")
    },
    {
      key: "event",
      label: "Event",
      icon: "calendar",
      accent: "#FEEBEF",
      tint: "#F43F5E",
      badge: 0,
      onPress: () => router.push("/countrylinqa/create?type=event")
    },
    {
      key: "post",
      label: "Post",
      icon: "create",
      accent: "#E3F6F3",
      tint: "#14B8A6",
      badge: 0,
      onPress: () => setStatusModal(true)
    },
    {
      key: "more",
      label: "More",
      icon: "ellipsis-horizontal",
      accent: "#FFFFFF",
      tint: "#64748B",
      badge: 0,
      onPress: () => router.push("/(tabs)/linqa")
    }
  ] as const;

  if (jurisdictionRequired) {
    // Jurisdiction is server-authoritative: Home is country-scoped, so there
    // is nothing honest to render until CountryLinqa verification completes.
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={s.screen}>
        <View style={s.gateWrap}>
          <View style={s.gateIcon}>
            <Ionicons name="globe-outline" size={28} color="#4F46E5" />
          </View>
          <Text style={s.gateTitle}>Confirm your country</Text>
          <Text style={s.gateCopy}>
            Home shows news, events and CountryLinqa for your verified country. Confirm it once and
            your feed is ready.
          </Text>
          <Pressable style={s.gateButton} onPress={() => router.push("/settings/countrylinqa")}>
            <Text style={s.gateButtonText}>Confirm country</Text>
          </Pressable>
          <Pressable onPress={load}>
            <Text style={s.gateRetry}>I already did — refresh</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
              <View style={s.logoTail} />
            </View>
            <Text style={s.wordmark}>LINQA</Text>
          </View>

          <View style={s.topActions}>
            <Pressable style={s.iconButton} onPress={() => router.push("/search")} accessibilityLabel="Search Linqa">
              <Ionicons name="search-outline" size={23} color="#0F172A" />
            </Pressable>
            <Pressable style={s.iconButton} onPress={() => router.push("/modules/ai")} accessibilityLabel="Ask Linqa AI">
              <Ionicons name="sparkles-outline" size={23} color="#0F172A" />
            </Pressable>
            <Pressable
              style={s.iconButton}
              onPress={() => router.push("/settings/notifications")}
              accessibilityLabel={badgeCount > 0 ? `Open notifications, ${badgeCount} unread` : "Open notifications"}
            >
              <Ionicons name="notifications-outline" size={23} color="#0F172A" />
              {badgeCount > 0 ? (
                <View style={s.notificationBadge}>
                  <Text style={s.notificationBadgeText}>{badgeCount > 99 ? "99+" : badgeCount}</Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable style={s.avatarButton} onPress={() => router.push("/account/manage")} accessibilityLabel="Open profile">
              <View style={s.avatarMini}>
                <Text style={s.avatarMiniText}>{initialsOf(feed?.profile?.displayName ?? "Linqa User")}</Text>
              </View>
              <View style={s.onlineDot} />
            </Pressable>
          </View>
        </View>

        <Text style={s.greeting}>{greeting()}, {firstName} <Text style={s.emoji}>👋</Text></Text>
        <Text style={s.subtitle}>
          {notifications && notifications.total > 0
            ? `${notifications.unreadMessages} unread ${notifications.unreadMessages === 1 ? "message" : "messages"}` +
              (notifications.pendingMessageRequests > 0
                ? ` · ${notifications.pendingMessageRequests} request${notifications.pendingMessageRequests === 1 ? "" : "s"}`
                : "")
            : "Here's what's happening in your world today."}
        </Text>

        {notifications && notifications.unacknowledgedSecurityAlerts > 0 ? (
          <Pressable style={s.securityBanner} onPress={() => router.push("/security")}>
            <Ionicons name="shield-half-outline" size={16} color="#B42318" />
            <Text style={s.securityBannerText}>
              {notifications.unacknowledgedSecurityAlerts} security alert
              {notifications.unacknowledgedSecurityAlerts === 1 ? "" : "s"} need your review
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#B42318" />
          </Pressable>
        ) : null}

        {degraded.length > 0 ? (
          <View style={s.degradedBanner}>
            <Ionicons name="information-circle-outline" size={15} color="#B54708" />
            <Text style={s.degradedText}>
              Temporarily unavailable: {degraded.map((section) => DEGRADED_LABELS[section] ?? section).join(", ")}.
            </Text>
          </View>
        ) : null}

        {hiddenSections.has("breakingAroundWorld") ? null : (
          <View style={s.heroWrap}>
            {/* One slide per breaking story, paged, with a dot per slide —
                the rest of the front page is reachable without scrolling
                down to the world rail. */}
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={pageTracker(cardWidth, setHeroPage)}
              scrollEnabled={heroStories.length > 1}
            >
              {(heroStories.length > 0 ? heroStories : [null]).map((story, index) => (
                <ImageBackground
                  key={story?.canonicalUrl ?? `hero-empty-${index}`}
                  source={story?.imageUrl ? { uri: story.imageUrl } : undefined}
                  style={[s.heroCard, { width: cardWidth }]}
                  imageStyle={s.heroImage}
                >
                  <LinearGradient
                    colors={["rgba(3,7,28,0.96)", "rgba(3,7,28,0.86)", "rgba(3,7,28,0.08)"]}
                    locations={[0, 0.52, 1]}
                    start={{ x: 0, y: 0.15 }}
                    end={{ x: 1, y: 0.85 }}
                    style={s.heroGradient}
                  >
                    <View style={s.heroContent}>
                      <View style={s.kickerRow}>
                        <Ionicons name="flash" size={13} color="#FF3B4E" />
                        {/* Only a publisher cleared for breaking coverage may be
                            presented under a BREAKING kicker. */}
                        <Text style={s.heroKicker}>
                          {story?.breakingEligible ? "BREAKING NEWS" : "WORLD NEWS"}
                        </Text>
                      </View>
                      <Text style={s.heroTitle} numberOfLines={3}>
                        {story?.title ?? (loading ? "Global news is refreshing" : stateCopy.detail)}
                      </Text>
                      <Text style={s.heroCopy} numberOfLines={2}>
                        {story ? attributionFor(story) : stateCopy.detail}
                      </Text>
                      <Pressable
                        style={s.heroButton}
                        onPress={() => (story ? void openLink(story.canonicalUrl) : load())}
                      >
                        <Text style={s.heroButtonText}>{story ? "Read Full Story" : "Retry"}</Text>
                        <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
                      </Pressable>
                      {story ? (
                        <Text style={s.heroPublisher} numberOfLines={1}>
                          Opens on {story.publisherDomain}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[s.livePill, newsState !== "LIVE" && s.stalePill]}>
                      <Text style={s.livePillText}>{stateCopy.label}</Text>
                    </View>
                  </LinearGradient>
                </ImageBackground>
              ))}
            </ScrollView>

            {heroStories.length > 1 ? (
              <View style={s.dotRow} pointerEvents="none">
                {heroStories.map((story, index) => (
                  <View
                    key={`hero-dot-${story.canonicalUrl}`}
                    style={index === clampPage(heroPage, heroStories.length) ? s.dotActive : s.dotInactive}
                  />
                ))}
              </View>
            ) : null}
          </View>
        )}

        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>QUICK ACTIONS</Text>
          <Pressable onPress={() => setCustomizeModal(true)}><Text style={s.sectionLink}>Customize</Text></Pressable>
        </View>

        <View style={s.quickGrid}>
          {quickActions.map((item) => (
            <Pressable
              key={item.key}
              style={s.quickItem}
              onPress={item.onPress}
              accessibilityRole="button"
              accessibilityLabel={
                item.badge > 0
                  ? `${item.label.replace("\n", " ")}, ${item.badge} waiting`
                  : item.label.replace("\n", " ")
              }
            >
              <View style={[s.quickIconWrap, { backgroundColor: item.accent }]}>
                <Ionicons name={item.icon as never} size={22} color={item.tint} />
                {item.badge > 0 ? (
                  <View style={s.quickBadge}>
                    <Text style={s.quickBadgeText}>{item.badge > 9 ? "9+" : item.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={s.quickLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        {hiddenSections.has("liveUpdates") && hiddenSections.has("spotlight") ? null : (
          <View style={s.updateGrid}>
            {hiddenSections.has("liveUpdates") ? null : (
              <View style={s.listPanel}>
                <View style={s.panelHeader}>
                  <View style={s.liveHeading}><View style={s.liveDot} /><Text style={s.panelTitle}>LIVE UPDATES</Text></View>
                  <Pressable onPress={() => router.push("/news")}><Text style={s.seeAll}>See all</Text></Pressable>
                </View>

                {liveUpdates.slice(0, 3).map((item, index) => (
                  <Pressable
                    key={item.id}
                    style={[s.listItem, index > 0 && s.listItemDivided]}
                    onPress={() => void openLink(item.canonicalUrl)}
                  >
                    <View style={s.listThumbWrap}>
                      {item.imageUrl ? (
                        <Image source={{ uri: item.imageUrl }} style={s.listThumb} />
                      ) : (
                        <View style={[s.listThumb, s.listThumbFallback]}>
                          <Ionicons name="newspaper-outline" size={18} color="#FFFFFF" />
                        </View>
                      )}
                      {item.breaking ? (
                        <View style={s.thumbLiveTag}><Text style={s.thumbLiveTagText}>LIVE</Text></View>
                      ) : null}
                    </View>
                    <View style={s.listBody}>
                      <Text style={s.listTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={s.listMeta} numberOfLines={1}>{attributionFor(item)}</Text>
                      {item.summary ? (
                        <Text style={s.listSummary} numberOfLines={1}>{item.summary}</Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={14} color="#667085" />
                  </Pressable>
                ))}
                {liveUpdates.length === 0 ? (
                  <View style={s.feedUnavailable}>
                    <Ionicons name="cloud-offline-outline" size={20} color="#667085" />
                    <Text style={s.feedUnavailableText}>{stateCopy.detail}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {hiddenSections.has("spotlight") ? null : (
              <ImageBackground
                source={spotlightStory?.imageUrl ? { uri: spotlightStory.imageUrl } : undefined}
                style={s.spotlightCard}
                imageStyle={s.spotlightImage}
              >
                <LinearGradient
                  colors={["rgba(3,7,28,0.95)", "rgba(3,7,28,0.74)", "rgba(3,7,28,0.14)"]}
                  locations={[0, 0.55, 1]}
                  start={{ x: 0, y: 0.2 }}
                  end={{ x: 1, y: 0.9 }}
                  style={s.spotlightGradient}
                >
                  <View style={s.spotlightHeading}>
                    <Ionicons name="star" size={12} color="#FFC928" />
                    <Text style={s.spotlightHeader}>SPOTLIGHT</Text>
                  </View>
                  <View style={s.spotlightBottom}>
                    <Text style={s.spotlightTitle} numberOfLines={3}>
                      {spotlightStory?.title ?? "Spotlight is unavailable"}
                    </Text>
                    <Text style={s.spotlightText} numberOfLines={2}>
                      {spotlightStory ? attributionFor(spotlightStory) : stateCopy.detail}
                    </Text>
                    <Pressable
                      style={s.primaryButton}
                      onPress={() => (spotlightStory ? void openLink(spotlightStory.canonicalUrl) : load())}
                    >
                      <Text style={s.primaryButtonText}>{spotlightStory ? "Read Full Story" : "Retry"}</Text>
                    </Pressable>
                    {/* The reach of this story's community, as a count. Who is
                        in your country's community is not Home's to publish. */}
                    {countryPanel && countryPanel.communityMembers > 0 ? (
                      <Pressable style={s.audienceRow} onPress={() => router.push("/countrylinqa/world")}>
                        <Ionicons name="people" size={12} color="#C9D2E3" />
                        <Text style={s.audienceText} numberOfLines={1}>
                          {compactCount(countryPanel.communityMembers)} in your community
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </LinearGradient>
              </ImageBackground>
            )}
          </View>
        )}

        {hiddenSections.has("upcoming") ? null : (
          <>
            <View style={s.sectionRow}>
              <Text style={s.panelTitle}>UPCOMING</Text>
              <Pressable onPress={() => router.push("/countrylinqa/world")}><Text style={s.seeAll}>See all</Text></Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.railScroll}
              contentContainerStyle={s.upcomingRow}
            >
              {upcoming.map((event) => {
                const date = new Date(event.startsAt);
                const place = eventPlace(event);
                return (
                  <Pressable key={event.id} style={s.eventCard} onPress={() => router.push("/countrylinqa/world")}>
                    <View style={s.eventTopRow}>
                      <View style={s.eventDateChip}>
                        <Text style={s.eventMonth}>{date.toLocaleDateString(undefined, { month: "short" })}</Text>
                        <Text style={s.eventDay}>{date.getDate()}</Text>
                      </View>
                      <View style={s.eventHeadline}>
                        <Text style={s.eventTime}>
                          {date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        </Text>
                        <Text style={s.eventTitle} numberOfLines={2}>{event.title}</Text>
                      </View>
                    </View>
                    <View style={s.eventDivider} />
                    <View style={s.eventMetaRow}>
                      <Ionicons name={place.icon as never} size={12} color="#64748B" />
                      <Text style={s.eventMeta} numberOfLines={1}>{place.label}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {upcoming.length === 0 ? (
                <Pressable style={[s.eventCard, s.emptyEventCard]} onPress={() => router.push("/countrylinqa/create?type=event")}>
                  <View style={s.emptyEventIcon}><Ionicons name="add" size={20} color="#5B4CFF" /></View>
                  <Text style={s.eventTitle}>Plan your next event</Text>
                  <Text style={s.eventMeta}>Create a real CountryLinqa event</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </>
        )}

        {hiddenSections.has("continueYourDay") && hiddenSections.has("countryLinqa") ? null : (
          <View style={s.bottomSplit}>
            {hiddenSections.has("continueYourDay") ? null : (
              <View style={s.continueColumn}>
                <View style={s.sectionRowWide}>
                  <Text style={s.panelTitle}>CONTINUE YOUR DAY</Text>
                  <Pressable onPress={() => router.push("/(tabs)/chats")}><Text style={s.seeAll}>See all</Text></Pressable>
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={s.railScroll}
                  contentContainerStyle={s.continueRow}
                >
                  {conversations.map((item) => (
                    <Pressable
                      key={item.conversationId}
                      style={s.continuePanel}
                      onPress={() =>
                        router.push({
                          pathname: "/(tabs)/chats",
                          params: { conversationId: item.conversationId }
                        })
                      }
                      accessibilityRole="button"
                    >
                      <View style={s.personRow}>
                        <View style={s.smallAvatar}>
                          <Text style={s.smallAvatarText}>{initialsOf(item.title || "Chat")}</Text>
                        </View>
                        <View style={s.personMeta}>
                          <Text style={s.personNameHuge} numberOfLines={1}>{item.title}</Text>
                          <Text style={s.personTime}>
                            {item.unreadCount > 0
                              ? `${item.unreadCount} unread message${item.unreadCount === 1 ? "" : "s"}`
                              : relativeAge(item.lastMessageAt)}
                          </Text>
                        </View>
                      </View>
                      <Text style={s.messageText} numberOfLines={2}>
                        {item.preview || "No preview available."}
                      </Text>
                      {item.unreadCount > 0 ? (
                        <View style={s.messageBadge}>
                          <Text style={s.unreadBadgeText}>{item.unreadCount}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ))}

                  {/* Vault items carry no server-readable name — the card is
                      labelled from the item type, size and recency. */}
                  {vaultItems.map((item) => {
                    const face = VAULT_ICONS[item.itemType] ?? VAULT_ICONS.OTHER;
                    return (
                      <Pressable
                        key={item.id}
                        style={s.utilityCard}
                        onPress={() => router.push("/modules/file-vault")}
                        accessibilityRole="button"
                      >
                        <View style={s.utilityTopRow}>
                          <View style={[s.utilityIcon, { backgroundColor: face.accent }]}>
                            <Ionicons name={face.icon as never} size={17} color={face.tint} />
                          </View>
                          <Ionicons name="ellipsis-horizontal" size={16} color="#94A3B8" />
                        </View>
                        <Text style={s.utilityTitle} numberOfLines={2}>{VAULT_LABELS[item.itemType]}</Text>
                        <Text style={s.utilitySub} numberOfLines={1}>
                          In LinqaVault · {byteLabel(item.sizeBytes)}
                        </Text>
                        <Text style={s.utilityFoot} numberOfLines={1}>
                          {updatedLabel(item.updatedAt)}
                        </Text>
                      </Pressable>
                    );
                  })}

                  {transfers.map((item) => (
                    <Pressable
                      key={item.id}
                      style={s.utilityCard}
                      onPress={() => router.push({ pathname: "/linqasend/status", params: { id: item.id } })}
                      accessibilityRole="button"
                    >
                      <View style={s.utilityTopRow}>
                        <View style={[s.utilityIcon, { backgroundColor: "#FFF0E6" }]}>
                          <Ionicons name="paper-plane" size={17} color="#FF7A29" />
                        </View>
                        <Ionicons name="ellipsis-horizontal" size={16} color="#94A3B8" />
                      </View>
                      <Text style={s.utilityTitle} numberOfLines={2}>Transfer to {item.recipientName}</Text>
                      <View style={s.transferMetaRow}>
                        <Text style={s.transferAmount} numberOfLines={1}>
                          {moneyLabel(item.sendAmountMinor, item.sendCurrency)}
                        </Text>
                        <Text style={s.transferStatus} numberOfLines={1}>
                          {transferStatusLabel(item.status)}
                        </Text>
                      </View>
                      <Text style={s.utilityFoot} numberOfLines={1}>
                        {item.resumable ? "Tap to continue" : "Tap to track"}
                      </Text>
                    </Pressable>
                  ))}

                  {!hasContinueCards ? (
                    <Pressable
                      style={s.continuePanel}
                      onPress={() => router.push("/(tabs)/chats")}
                      accessibilityRole="button"
                    >
                      <View style={s.personRow}>
                        <View style={s.smallAvatar}>
                          <Ionicons name="chatbubbles-outline" size={15} color="#111827" />
                        </View>
                        <View style={s.personMeta}>
                          <Text style={s.personNameHuge} numberOfLines={1}>Open your chats</Text>
                          <Text style={s.personTime}>Nothing in progress</Text>
                        </View>
                      </View>
                      <Text style={s.messageText} numberOfLines={2}>
                        Conversations, Vault activity and money in flight show up here.
                      </Text>
                    </Pressable>
                  ) : null}
                </ScrollView>
              </View>
            )}

            {hiddenSections.has("countryLinqa") ? null : (
              <View style={s.countryPanel}>
                <View style={s.countryHeader}>
                  <Text style={s.countryTitle} numberOfLines={1}>COUNTRYLINQA</Text>
                  <Pressable onPress={() => router.push("/countrylinqa/world")} hitSlop={6}>
                    <Text style={s.countrySeeAll}>See all</Text>
                  </Pressable>
                </View>
                <View style={s.countryMetaRow}>
                  <View style={s.countryIdentity}>
                    <Text style={s.countryFlag}>{countryFlag(countryPanel?.countryCode ?? feed?.jurisdictionCountry)}</Text>
                    <Text style={s.countryLabel} numberOfLines={1}>
                      {countryPanel?.countryName ?? feed?.jurisdictionCountry ?? "Your country"}
                    </Text>
                  </View>
                  <Pressable onPress={() => router.push("/settings/countrylinqa")} hitSlop={6}>
                    <Text style={s.countryChange}>Change</Text>
                  </Pressable>
                </View>
                <Text style={s.countrySmall}>
                  {countryPanel && countryPanel.publishedEvents > 0
                    ? `${countryPanel.publishedEvents} upcoming event${countryPanel.publishedEvents === 1 ? "" : "s"} near you`
                    : "Trending in your country"}
                </Text>
                {(countryPanel?.trends ?? []).map((trend) => (
                  <Pressable
                    key={trend.category}
                    style={s.countryTrend}
                    onPress={() => router.push({ pathname: "/news", params: { category: trend.category } })}
                  >
                    <View style={s.trendRank}><Text style={s.trendRankText}>{trend.rank}</Text></View>
                    <View style={s.trendBody}>
                      <Text style={s.trendTitle}>{humanizeCategory(trend.category)}</Text>
                      <Text style={s.trendValue}>
                        {trend.storyCount} live {trend.storyCount === 1 ? "story" : "stories"}
                      </Text>
                    </View>
                    <Ionicons name="trending-up" size={15} color="#22C55E" />
                  </Pressable>
                ))}
                {(countryPanel?.trends.length ?? 0) === 0 ? (
                  <Text style={s.countrySmall}>Trends appear once the news service reconnects.</Text>
                ) : null}
              </View>
            )}
          </View>
        )}

        {hiddenSections.has("breakingAroundWorld") ? null : (
          <View style={s.worldPanel}>
            <View style={s.worldRow}>
              <View style={s.worldHeading}>
                <Ionicons name="earth" size={14} color="#FFC928" />
                <Text style={s.worldPanelTitle}>BREAKING AROUND THE WORLD</Text>
              </View>
              <Pressable onPress={() => router.push("/news")}><Text style={s.worldSeeAll}>See all</Text></Pressable>
            </View>

            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={pageTracker(worldCardWidth, setWorldPage)}
              scrollEnabled={worldPagesOfStories.length > 1}
            >
              {worldPagesOfStories.map((page, pageIndex) => (
                <View key={`world-page-${pageIndex}`} style={[s.worldGrid, { width: worldCardWidth }]}>
                  {page.map((item: HomeNewsItem) => (
                    <Pressable key={item.canonicalUrl} style={s.worldCard} onPress={() => void openLink(item.canonicalUrl)}>
                      {item.imageUrl ? (
                        <Image source={{ uri: item.imageUrl }} style={s.worldImage} />
                      ) : (
                        <View style={[s.worldImage, s.worldImageFallback]}>
                          <Ionicons name="newspaper-outline" size={20} color="#7C6CFF" />
                        </View>
                      )}
                      <View style={s.worldBody}>
                        <View style={s.worldTagRow}>
                          <View style={[s.worldTagDot, { backgroundColor: categoryColor(item.category) }]} />
                          <Text style={[s.worldTag, { color: categoryColor(item.category) }]} numberOfLines={1}>
                            {item.category}
                          </Text>
                        </View>
                        <Text style={s.worldLabel} numberOfLines={3}>{item.title}</Text>
                        {/* Attribution is a licensing obligation, not decoration. */}
                        <Text style={s.worldTime} numberOfLines={1}>{item.publisherName}</Text>
                        <Text style={s.worldTime}>{relativeAge(item.publishedAt)}</Text>
                      </View>
                    </Pressable>
                  ))}
                  {/* Keep the last page's cards the same width as a full page. */}
                  {Array.from({ length: WORLD_PER_PAGE - page.length }).map((_unused, index) => (
                    <View key={`world-filler-${pageIndex}-${index}`} style={s.worldCardFiller} />
                  ))}
                </View>
              ))}
            </ScrollView>

            {worldPagesOfStories.length > 1 ? (
              <View style={s.worldDots}>
                {worldPagesOfStories.map((_page, index) => (
                  <View
                    key={`world-dot-${index}`}
                    style={
                      index === clampPage(worldPage, worldPagesOfStories.length)
                        ? s.worldDotActive
                        : s.worldDot
                    }
                  />
                ))}
              </View>
            ) : null}

            {worldStories.length === 0 ? (
              <View style={s.worldEmpty}>
                <Ionicons name="cloud-offline-outline" size={20} color="#AEB9CC" />
                <Text style={s.worldEmptyText}>{stateCopy.detail}</Text>
                <Pressable onPress={load}><Text style={s.worldRetry}>Retry</Text></Pressable>
              </View>
            ) : null}
          </View>
        )}

        <View style={s.aiToolsRow}>
          <Pressable style={s.askRow} onPress={() => router.push("/modules/ai")} accessibilityRole="button">
            <View style={s.aiIconWrap}><Ionicons name="sparkles-outline" size={18} color="#FFFFFF" /></View>
            <View style={s.aiTextWrap}>
              <Text style={s.aiTitle}>Ask Linqa AI</Text>
              <Text style={s.aiSubtitle}>
                {notifications && notifications.unreadMessages > 0
                  ? `Summarize my ${notifications.unreadMessages} unread messages`
                  : "Summarize my unread messages"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#111827" />
          </Pressable>
          <Pressable style={s.aiToolButton} onPress={() => router.push({ pathname: "/modules/ai", params: { mode: "voice" } })}>
            <Ionicons name="mic-outline" size={18} color="#5B4CFF" />
            <Text style={s.aiToolText}>Voice</Text>
          </Pressable>
          <Pressable style={s.aiToolButton} onPress={() => router.push("/(tabs)/media")}>
            <Ionicons name="camera-outline" size={18} color="#5B4CFF" />
            <Text style={s.aiToolText}>Camera</Text>
          </Pressable>
        </View>

        {feed ? (
          <Text style={s.provenance}>
            Headlines open on the original publisher's site. {stateCopy.detail} Updated{" "}
            {relativeAge(feed.generatedAt) || "now"}.
          </Text>
        ) : null}

        {error ? (
          <Pressable style={s.errorCard} onPress={load}>
            <Ionicons name="warning-outline" size={18} color="#B42318" />
            <Text style={s.errorText}>{error} Tap to retry.</Text>
          </Pressable>
        ) : null}

        {loading && !feed ? (
          <View style={s.center}>
            <ActivityIndicator color={colors.accent} />
            <Text style={s.muted}>Refreshing your Linqa world</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={statusModal} transparent animationType="fade" onRequestClose={() => setStatusModal(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>My status</Text>
            <TextInput
              value={statusDraft}
              onChangeText={(text) => setStatusDraft(text.slice(0, 280))}
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
            {(hub?.contacts.length ?? 0) === 0 ? (
              <Text style={s.muted}>No contacts are available to message yet.</Text>
            ) : null}
            <Pressable onPress={() => setComposeModal(false)} style={{ marginTop: spacing.md }}>
              <Text style={s.modalCancel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={customizeModal} transparent animationType="slide" onRequestClose={() => setCustomizeModal(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Customize Home</Text>
            <Text style={s.modalCopy}>
              Hidden sections are not fetched at all, so hiding one also stops the work behind it.
            </Text>

            <View style={s.preferenceRow}>
              <View style={s.preferenceCopy}>
                <Text style={s.preferenceLabel}>Personalize my feed</Text>
                <Text style={s.preferenceHint}>
                  Rank news by the countries and topics you follow. Off by default.
                </Text>
              </View>
              <Switch
                value={feed?.serviceState.personalized ?? false}
                onValueChange={togglePersonalization}
                disabled={savingPreferences}
              />
            </View>

            {HIDEABLE_HOME_SECTIONS.map((section) => (
              <View key={section} style={s.preferenceRow}>
                <View style={s.preferenceCopy}>
                  <Text style={s.preferenceLabel}>{SECTION_LABELS[section]}</Text>
                </View>
                <Switch
                  value={!hiddenSections.has(section)}
                  onValueChange={(visible) => toggleSection(section, visible)}
                  disabled={savingPreferences}
                />
              </View>
            ))}

            <Pressable onPress={() => setCustomizeModal(false)} style={{ marginTop: spacing.md }}>
              <Text style={s.modalCancel}>Done</Text>
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
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function humanizeCategory(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((character) => 127397 + character.charCodeAt(0))
  );
}

function categoryColor(category: string): string {
  return CATEGORY_COLORS[(category ?? "").toUpperCase()] ?? CATEGORY_COLORS.GENERAL;
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

/** A refresh can shorten the feed under a page index the user already left. */
function clampPage(page: number, pageCount: number): number {
  return Math.max(0, Math.min(page, pageCount - 1));
}

/** Maps a paged scroll offset back to a page index for the dot rail. */
function pageTracker(pageWidth: number, onPage: (page: number) => void) {
  return (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pageWidth <= 0) return;
    onPage(Math.round(event.nativeEvent.contentOffset.x / pageWidth));
  };
}

function eventPlace(event: HomeUpcomingEvent): { icon: string; label: string } {
  if (event.city) return { icon: "location-outline", label: event.city };
  if (event.countryCode) return { icon: "flag-outline", label: event.countryCode.toUpperCase() };
  return { icon: "globe-outline", label: "Online event" };
}

/**
 * `relativeAge` yields "now", a "12m"/"3h"/"2d" span, or a calendar date once
 * a week has passed. Only the middle form reads correctly with "ago".
 */
function updatedLabel(value: string): string {
  const age = relativeAge(value);
  if (!age) return "Updated recently";
  if (age === "now") return "Updated just now";
  if (/^\d+[mhd]$/.test(age)) return `Updated ${age} ago`;
  return `Updated ${age}`;
}

function byteLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function compactCount(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/**
 * Currencies whose smallest unit *is* the unit. Everything else in the
 * LinqaSend corridors is two-decimal, matching the rest of the money screens.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW",
  "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"
]);

/**
 * Symbols only where the symbol is unambiguous. A bare "$" for CAD or AUD
 * would misstate the amount, so those fall through to the ISO code.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  INR: "₹",
  NGN: "₦"
};

function moneyLabel(minor: string, currency: string): string {
  const code = (currency ?? "").toUpperCase();
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(code);
  const units = zeroDecimal ? Number(minor) : Number(minor) / 100;
  if (!Number.isFinite(units)) return `${minor} ${code}`.trim();
  const amount = units.toLocaleString(undefined, {
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: zeroDecimal ? 0 : 2
  });
  const symbol = CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${amount}` : `${amount} ${code}`.trim();
}

/** "AWAITING_CONFIRMATION" -> "Awaiting confirmation". */
function transferStatusLabel(status: string): string {
  const words = (status ?? "").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const s = StyleSheet.create({
  gateWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 10 },
  gateIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center", marginBottom: 6 },
  gateTitle: { color: "#0F172A", fontSize: 20, fontFamily: fonts.extrabold, letterSpacing: -0.3 },
  gateCopy: { color: "#475569", fontSize: 13, fontFamily: fonts.regular, lineHeight: 19, textAlign: "center" },
  gateButton: { marginTop: 10, backgroundColor: "#4F46E5", borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12 },
  gateButtonText: { color: "#FFFFFF", fontFamily: fonts.extrabold, fontSize: 13 },
  gateRetry: { marginTop: 12, color: "#4F46E5", fontFamily: fonts.bold, fontSize: 12 },
  securityBanner: { marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA" },
  securityBannerText: { flex: 1, color: "#B42318", fontSize: 11.5, fontFamily: fonts.bold },
  degradedBanner: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#FFFAEB", borderWidth: 1, borderColor: "#FEDF89" },
  degradedText: { flex: 1, color: "#B54708", fontSize: 11, fontFamily: fonts.regular, lineHeight: 15 },
  heroPublisher: { marginTop: 8, color: "#AEB9CC", fontSize: 9.5, fontFamily: fonts.semibold, maxWidth: "58%" },
  worldEmpty: { alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 22 },
  worldEmptyText: { color: "#AEB9CC", fontSize: 10.5, fontFamily: fonts.regular, textAlign: "center", paddingHorizontal: 18 },
  worldRetry: { color: "#B89CFF", fontSize: 11, fontFamily: fonts.extrabold },
  provenance: { marginTop: 14, color: "#64748B", fontSize: 10, fontFamily: fonts.regular, lineHeight: 14 },
  modalCopy: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.regular, lineHeight: 17, marginBottom: spacing.md },
  preferenceRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  preferenceCopy: { flex: 1 },
  preferenceLabel: { color: colors.text, fontSize: 13.5, fontFamily: fonts.bold },
  preferenceHint: { color: colors.textFaint, fontSize: 11, fontFamily: fonts.regular, marginTop: 2, lineHeight: 15 },
  screen: { flex: 1, backgroundColor: "#F4F6FB" },
  content: { paddingHorizontal: GUTTER, paddingTop: 10, paddingBottom: 96 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  brandWrap: { flexDirection: "row", alignItems: "center", gap: 9 },
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
  // The tail of the Q in the wordmark lockup.
  logoTail: { position: "absolute", right: 5, bottom: 5, width: 8, height: 3, borderRadius: 2, backgroundColor: "#FFFFFF", transform: [{ rotate: "45deg" }] },
  wordmark: { color: "#0F172A", fontSize: 26, fontFamily: fonts.extrabold, letterSpacing: -0.7 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  iconButton: { alignItems: "center", justifyContent: "center", position: "relative" },
  notificationBadge: { position: "absolute", top: -6, right: -7, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 3, alignItems: "center", justifyContent: "center", backgroundColor: "#FF3B4E", borderWidth: 2, borderColor: "#F4F6FB" },
  notificationBadgeText: { color: "#FFFFFF", fontSize: 8, fontFamily: fonts.extrabold },
  avatarButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", alignItems: "center", justifyContent: "center", marginLeft: 2 },
  avatarMini: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#F5D0FE",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarMiniText: { color: "#0F172A", fontSize: 10.5, fontFamily: fonts.extrabold },
  onlineDot: { position: "absolute", right: -1, bottom: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: "#22C55E", borderWidth: 2, borderColor: "#FFFFFF" },
  greeting: { marginTop: 18, color: "#111827", fontSize: 20, fontFamily: fonts.extrabold, letterSpacing: -0.25 },
  emoji: { fontSize: 18, fontFamily: fonts.regular },
  subtitle: { color: "#475569", fontSize: 12.5, fontFamily: fonts.regular, marginTop: 2 },
  heroWrap: { marginTop: 14, position: "relative" },
  heroCard: {
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
  heroContent: { flex: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  heroKicker: { color: "#FF4859", fontSize: 9, fontFamily: fonts.extrabold, letterSpacing: 0.8 },
  heroTitle: { marginTop: 9, color: "#FFFFFF", fontSize: 19, fontFamily: fonts.extrabold, letterSpacing: -0.35, lineHeight: 23, maxWidth: "66%" },
  heroCopy: { marginTop: 6, color: "#E2E8F0", fontSize: 11.5, fontFamily: fonts.regular, lineHeight: 15, maxWidth: "62%" },
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
  heroButtonText: { color: "#FFFFFF", fontFamily: fonts.extrabold, fontSize: 12 },
  dotRow: { position: "absolute", bottom: 10, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 7 },
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
  livePillText: { color: "#FFFFFF", fontSize: 10, fontFamily: fonts.extrabold },
  stalePill: { backgroundColor: "#667085" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  sectionTitle: { color: "#111827", fontSize: 13, fontFamily: fonts.extrabold, letterSpacing: 0.12 },
  sectionLink: { color: "#4F46E5", fontSize: 11.5, fontFamily: fonts.bold },
  // Seven tiles on one row, as designed. The cell is an exact 1/7 of the
  // content width and the label is bounded by the cell -- a label wider than
  // its cell is what silently wraps "More" onto a second row.
  quickGrid: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  quickItem: { width: "14.28%", alignItems: "center", justifyContent: "flex-start" },
  quickIconWrap: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  quickBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5B4CFF",
    borderWidth: 2,
    borderColor: "#F4F6FB"
  },
  quickBadgeText: { color: "#FFFFFF", fontSize: 8, fontFamily: fonts.extrabold },
  quickLabel: {
    marginTop: 5,
    color: "#111827",
    fontSize: 9,
    fontFamily: fonts.bold,
    textAlign: "center",
    lineHeight: 11,
    width: "100%"
  },
  panelHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 2, paddingBottom: 4 },
  liveHeading: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FF3B4E" },
  panelTitle: { color: "#111827", fontSize: 12.5, fontFamily: fonts.extrabold, letterSpacing: 0.1 },
  seeAll: { color: "#4F46E5", fontSize: 11.5, fontFamily: fonts.bold },
  updateGrid: { flexDirection: "row", gap: 10, marginTop: 16 },
  listPanel: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#E2E8F0", padding: 9 },
  listItem: { flexDirection: "row", alignItems: "center", paddingVertical: 7, gap: 8 },
  listItemDivided: { borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  listThumbWrap: { position: "relative" },
  listThumb: { width: 40, height: 40, borderRadius: 10 },
  listThumbFallback: { backgroundColor: "#5B4CFF", alignItems: "center", justifyContent: "center" },
  thumbLiveTag: {
    position: "absolute",
    left: -2,
    bottom: -3,
    backgroundColor: "#22C55E",
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1
  },
  thumbLiveTagText: { color: "#FFFFFF", fontSize: 6.5, fontFamily: fonts.extrabold, letterSpacing: 0.2 },
  listBody: { flex: 1 },
  listTitle: { color: "#111827", fontSize: 11.5, fontFamily: fonts.extrabold },
  listMeta: { color: "#64748B", fontSize: 9.5, fontFamily: fonts.regular, marginTop: 2 },
  listSummary: { color: "#94A3B8", fontSize: 9, fontFamily: fonts.regular, marginTop: 2 },
  feedUnavailable: { minHeight: 130, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 10 },
  feedUnavailableText: { color: "#667085", fontSize: 10.5, fontFamily: fonts.regular, textAlign: "center" },
  spotlightCard: {
    flex: 1,
    backgroundColor: "#090C1A",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#111827",
    overflow: "hidden",
    minHeight: 178
  },
  spotlightImage: { borderRadius: 14 },
  spotlightGradient: { flex: 1, padding: 12, justifyContent: "space-between" },
  spotlightHeading: { flexDirection: "row", alignItems: "center", gap: 5 },
  spotlightBottom: { marginTop: 18 },
  spotlightHeader: { color: "#E2E8F0", fontSize: 9.5, fontFamily: fonts.extrabold, letterSpacing: 0.2 },
  spotlightTitle: { color: "#FFFFFF", fontSize: 16.5, fontFamily: fonts.extrabold, lineHeight: 21, marginTop: 8 },
  spotlightText: { color: "#DDE6F4", fontSize: 11.5, fontFamily: fonts.regular, lineHeight: 16, marginTop: 6 },
  primaryButton: {
    marginTop: 11,
    backgroundColor: "#4F46E5",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 12.5, fontFamily: fonts.extrabold },
  audienceRow: { marginTop: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  audienceText: { color: "#C9D2E3", fontSize: 9.5, fontFamily: fonts.bold, flexShrink: 1 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  railScroll: { marginTop: 10 },
  upcomingRow: { flexDirection: "row", gap: 8, paddingRight: 4 },
  eventCard: {
    width: 152,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 9
  },
  eventTopRow: { flexDirection: "row", gap: 8 },
  eventDateChip: {
    width: 38,
    borderRadius: 9,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    paddingVertical: 4
  },
  eventMonth: { color: "#4F46E5", fontSize: 8, fontFamily: fonts.extrabold, textTransform: "uppercase", letterSpacing: 0.3 },
  eventDay: { color: "#111827", fontSize: 17, fontFamily: fonts.extrabold, lineHeight: 20 },
  eventHeadline: { flex: 1 },
  eventTime: { color: "#64748B", fontSize: 9, fontFamily: fonts.bold },
  eventTitle: { color: "#111827", fontSize: 11, fontFamily: fonts.extrabold, lineHeight: 14, marginTop: 2 },
  eventDivider: { height: 1, backgroundColor: "#EEF2F6", marginVertical: 8 },
  eventMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  eventMeta: { color: "#64748B", fontSize: 9.5, fontFamily: fonts.regular, flexShrink: 1 },
  emptyEventCard: { minHeight: 86, alignItems: "flex-start", justifyContent: "center", gap: 4 },
  emptyEventIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#F0EEFF" },
  sectionRowWide: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bottomSplit: { flexDirection: "row", gap: 10, marginTop: 18, alignItems: "flex-start" },
  continueColumn: { flex: 1.62 },
  continueRow: { flexDirection: "row", gap: 8, paddingRight: 4 },
  continuePanel: {
    width: 168,
    minHeight: 104,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 10,
    position: "relative"
  },
  personRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  smallAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#F5D0FE", alignItems: "center", justifyContent: "center" },
  smallAvatarText: { color: "#111827", fontFamily: fonts.extrabold, fontSize: 9.5 },
  personMeta: { flex: 1 },
  personNameHuge: { color: "#111827", fontFamily: fonts.extrabold, fontSize: 11.5 },
  personTime: { color: "#64748B", fontSize: 9, fontFamily: fonts.regular, marginTop: 1 },
  messageText: { color: "#475569", fontSize: 10.5, fontFamily: fonts.regular, lineHeight: 14, marginTop: 8 },
  messageBadge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#4F46E5",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5
  },
  utilityCard: {
    width: 116,
    minHeight: 104,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 9
  },
  utilityTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  utilityIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  utilityTitle: { color: "#111827", fontSize: 10.5, fontFamily: fonts.extrabold, lineHeight: 13, marginTop: 8 },
  utilitySub: { color: "#64748B", fontSize: 8.5, fontFamily: fonts.regular, marginTop: 3 },
  utilityFoot: { color: "#94A3B8", fontSize: 8.5, fontFamily: fonts.regular, marginTop: 5 },
  transferMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, flexWrap: "wrap" },
  transferAmount: { color: "#111827", fontSize: 9.5, fontFamily: fonts.extrabold },
  transferStatus: { color: "#B54708", fontSize: 8.5, fontFamily: fonts.bold },
  countryPanel: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 10
  },
  countryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6 },
  countryTitle: { color: "#111827", fontFamily: fonts.extrabold, fontSize: 10, flexShrink: 1 },
  countrySeeAll: { color: "#4F46E5", fontSize: 9.5, fontFamily: fonts.bold },
  countryMetaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 6 },
  countryIdentity: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  countryFlag: { fontSize: 13, fontFamily: fonts.regular },
  countryLabel: { color: "#111827", fontFamily: fonts.extrabold, fontSize: 10.5, flexShrink: 1 },
  countryChange: { color: "#4F46E5", fontFamily: fonts.bold, fontSize: 9.5 },
  countrySmall: { color: "#64748B", fontSize: 10, fontFamily: fonts.regular, marginTop: 8 },
  countryTrend: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  trendRank: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" },
  trendRankText: { color: "#4F46E5", fontSize: 9, fontFamily: fonts.extrabold },
  trendBody: { flex: 1 },
  trendTitle: { color: "#111827", fontSize: 11, fontFamily: fonts.bold },
  trendValue: { color: "#64748B", fontSize: 9, fontFamily: fonts.regular, marginTop: 2 },
  worldPanel: { marginTop: 18, backgroundColor: "#071028", borderRadius: 15, padding: 11, overflow: "hidden" },
  worldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  worldHeading: { flexDirection: "row", alignItems: "center", gap: 6 },
  worldPanelTitle: { color: "#FFFFFF", fontSize: 10.5, fontFamily: fonts.extrabold, letterSpacing: 0.1 },
  worldSeeAll: { color: "#C9D2E3", fontSize: 10.5, fontFamily: fonts.bold },
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
  worldCardFiller: { flex: 1 },
  worldImage: { width: "100%", height: 45 },
  worldImageFallback: { backgroundColor: "#141A38", alignItems: "center", justifyContent: "center" },
  worldBody: { padding: 7, flex: 1 },
  worldTagRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  worldTagDot: { width: 5, height: 5, borderRadius: 2.5 },
  worldTag: { fontSize: 6.8, fontFamily: fonts.extrabold, letterSpacing: 0.5, flexShrink: 1 },
  worldLabel: { color: "#FFFFFF", fontSize: 9.5, fontFamily: fonts.extrabold, marginTop: 4, lineHeight: 12 },
  worldTime: { color: "#AEB9CC", fontSize: 8, fontFamily: fonts.regular, marginTop: 4 },
  worldDots: { marginTop: 9, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5 },
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
  aiTitle: { color: "#111827", fontFamily: fonts.extrabold, fontSize: 12.5 },
  aiSubtitle: { color: "#64748B", fontSize: 11, fontFamily: fonts.regular, marginTop: 2 },
  aiToolButton: { minWidth: 58, borderRadius: 14, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", paddingHorizontal: 6, gap: 3 },
  aiToolText: { color: "#5B4CFF", fontSize: 9.5, fontFamily: fonts.extrabold },
  errorCard: { marginTop: 12, borderRadius: 12, padding: 10, backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA", flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { color: "#B42318", fontSize: 10.5, fontFamily: fonts.regular, flex: 1 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xl, gap: spacing.sm },
  muted: { color: colors.textFaint, fontSize: 12, fontFamily: fonts.regular },
  unreadBadgeText: { color: colors.onAccent, fontFamily: fonts.extrabold, fontSize: 10 },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  modalCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  modalTitle: { color: colors.text, fontSize: 18, fontFamily: fonts.extrabold, marginBottom: spacing.md },
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
  modalCancel: { color: colors.textMuted, fontFamily: fonts.bold },
  modalConfirm: { color: colors.accent, fontFamily: fonts.extrabold },
  contactRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  contactRowText: { color: colors.text, fontSize: 14, fontFamily: fonts.regular }
});

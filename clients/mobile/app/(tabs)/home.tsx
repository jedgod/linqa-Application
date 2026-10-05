import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, ImageBackground, Linking, Modal, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { MobileHubService, type HubContact, type HubSnapshot } from "../../services/mobile-hub.service";
import { HIDEABLE_HOME_SECTIONS, HomeFeedService, JurisdictionRequiredError, attributionFor, newsStateLabel, relativeAge, type HideableHomeSection, type HomeFeedPayload, type HomeNewsItem } from "../../services/home-feed.service";
import { accessTokenProvider } from "../../services/session";
import { colors, spacing } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";
import { useLinqaSendAvailability } from "../../services/linqasend-availability";
import { GUTTER, s } from "../../components/home/styles";
import { HERO_SLOTS, WORLD_PER_PAGE, WORLD_PAGES, HomeUpcomingCard, UPCOMING_SUGGESTIONS, SECTION_LABELS, DEGRADED_LABELS, VAULT_LABELS, VAULT_ICONS, greeting, initialsOf, humanizeCategory, countryFlag, categoryColor, chunk, clampPage, pageTracker, eventPlace, updatedLabel, byteLabel, compactCount, moneyLabel, transferStatusLabel } from "../../components/home/helpers";

const API = getApiBaseUrl();

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
  const moneyAvailable = useLinqaSendAvailability() === true;
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
  const upcomingCardWidth = Math.floor((cardWidth - 20) / 3);
  const compactUpcomingCards = upcomingCardWidth < 150;

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
  const publishedUpcoming = (feed?.upcoming ?? []).slice(0, 4);
  const upcoming: HomeUpcomingCard[] = [
    ...publishedUpcoming,
    ...(feed
      ? UPCOMING_SUGGESTIONS.slice(0, 4 - publishedUpcoming.length).map((suggestion, index) => {
          const startsAt = new Date();
          startsAt.setDate(startsAt.getDate() + suggestion.daysFromNow);
          startsAt.setHours(suggestion.hour, suggestion.minute, 0, 0);
          return {
            id: `suggested-${index}`,
            title: suggestion.title,
            startsAt: startsAt.toISOString(),
            countryCode: null,
            regionCode: null,
            city: null,
            suggested: true,
            displayPlace: { icon: suggestion.icon, label: `Suggested · ${suggestion.label}` }
          };
        })
      : [])
  ].slice(0, 4);
  const eventsRoute = "/countrylinqa/list?kind=events&title=Events";

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

  const allQuickActions = [
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
  const quickActions = allQuickActions.filter((item) => moneyAvailable || item.key !== "send");

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
                        <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
                      </Pressable>
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
                        <Image source={{ uri: item.imageUrl }} style={s.listThumb} resizeMode="cover" />
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="See all upcoming events"
                onPress={() => router.push(eventsRoute as never)}
              >
                <Text style={s.seeAll}>See all</Text>
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.railScroll}
              contentContainerStyle={s.upcomingRow}
            >
              {upcoming.map((event) => {
                const date = new Date(event.startsAt);
                const place = event.displayPlace ?? eventPlace(event);
                return (
                  <Pressable
                    key={event.id}
                    style={[
                      s.eventCard,
                      { width: upcomingCardWidth },
                      compactUpcomingCards && s.eventCardCompact
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${event.suggested ? "Suggested plan" : "Event"}: ${event.title}`}
                    onPress={() => event.suggested
                      ? router.push({
                          pathname: "/countrylinqa/create",
                          params: {
                            type: "event",
                            title: event.title,
                            startsAt: event.startsAt
                          }
                        })
                      : router.push(eventsRoute as never)}
                  >
                    <View style={[s.eventTopRow, compactUpcomingCards && s.eventTopRowCompact]}>
                      <View style={[s.eventDateChip, compactUpcomingCards && s.eventDateChipCompact]}>
                        <Text style={[
                          s.eventMonth,
                          compactUpcomingCards && s.eventMonthCompact,
                          event.suggested && s.eventSuggestedMonth
                        ]}>
                          {date.toLocaleDateString(undefined, { month: "short" })}
                        </Text>
                        <Text style={[s.eventDay, compactUpcomingCards && s.eventDayCompact]}>{date.getDate()}</Text>
                      </View>
                      <View style={s.eventHeadline}>
                        <Text style={[s.eventTime, compactUpcomingCards && s.eventTimeCompact]}>
                          {date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        </Text>
                        <Text
                          style={[s.eventTitle, compactUpcomingCards && s.eventTitleCompact]}
                          numberOfLines={compactUpcomingCards ? 3 : 2}
                        >
                          {event.title}
                        </Text>
                      </View>
                    </View>
                    <View style={[s.eventDivider, compactUpcomingCards && s.eventDividerCompact]} />
                    <View style={[s.eventMetaRow, compactUpcomingCards && s.eventMetaRowCompact]}>
                      <Ionicons name={place.icon as never} size={12} color="#64748B" />
                      <Text style={[s.eventMeta, compactUpcomingCards && s.eventMetaCompact]} numberOfLines={1}>
                        {place.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
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
                        <Text style={s.worldLabel} numberOfLines={2}>{item.title}</Text>
                        {item.summary ? (
                          <Text style={s.worldSummary} numberOfLines={1}>{item.summary}</Text>
                        ) : null}
                        <View style={s.worldMeta}>
                          {/* Attribution is a licensing obligation, not decoration. */}
                          <Text style={s.worldTime} numberOfLines={1}>{item.publisherName}</Text>
                          <Text style={s.worldTime}>·</Text>
                          <Text style={s.worldTime} numberOfLines={1}>{relativeAge(item.publishedAt)}</Text>
                        </View>
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
            <Image
              source={require("../../assets/ai-assistant.png")}
              style={s.aiIcon}
              resizeMode="contain"
              accessibilityLabel="Linqa AI assistant"
            />
            <View style={s.aiTextWrap}>
              <Text style={s.aiTitle} numberOfLines={1}>Ask Linqa AI</Text>
              <Text style={s.aiSubtitle} numberOfLines={1}>Summarize my unread messages</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#4438CA" />
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

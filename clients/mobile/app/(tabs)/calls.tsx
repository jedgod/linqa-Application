import { t, i18n } from '../../i18n';
import { useTranslation } from 'react-i18next';
// Calls screen for the mobile app, displaying call history, scheduled calls, and contact interactions.
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  ImageSourcePropType,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "../../components/LinearGradient";
import { RecordingsSection } from "../../components/calls/RecordingsSection";
import { useLocalSearchParams, useRouter } from "expo-router";
import { upcomingOf, useMyEvents } from "../../services/my-events";
import { CallsService, callDateBucket, formatScheduledFor, type CallHistoryItem, type ScheduledCall } from "../../services/calls.service";
import { CallPlanner, type PlannerMode } from "../../components/calls/CallPlanner";
import { startSecureCallForPeer } from "../../services/secure-call-rooms";
import { isJoinLocked, joinScheduledCallNow, onJoinLockChange } from "../../services/scheduled-call-join";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";
import { useProfile } from "../../hooks/useProfile";
import { avatarUri } from "../../lib/profileApi";
import { useAvatarImage } from "../../components/account/Avatar";
import { PhotoZoom } from "../../components/account/PhotoZoom";

type Filter = "All" | "Missed" | "Audio" | "Video";
type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type Call = {
  id: string;
  peerUserId?: string;
  name: string;
  country?: string;
  flag?: string;
  time: string;
  missed?: boolean;
  direction: "incoming" | "outgoing";
  kind: "audio" | "video" | "group";
  /** Full URL of the caller's profile photo, when they have one. */
  photoUrl?: string | null;
};

const COLORS = {
  background: "#020A1D",
  surface: "#07142C",
  surface2: "#0A1935",
  border: "#203357",
  text: "#F7F9FF",
  muted: "#A6B4DC",
  blue: "#068BFF",
  cyan: "#05C9F6",
  red: "#FF5B67",
};

const AVATARS = {
  profile: require("../../assets/avatars/profile.png"),
  placeholder: require("../../assets/avatars/placeholder.png"),
  p1: require("../../assets/avatars/p1.png"),
  p2: require("../../assets/avatars/p2.png"),
  p3: require("../../assets/avatars/p3.png"),
  p4: require("../../assets/avatars/p4.png"),
} satisfies Record<string, ImageSourcePropType>;

const flagOf = (code?: string | null) =>
  code && /^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : undefined;

function toCall(item: CallHistoryItem): Call {
  const when = new Date(item.createdAt);
  const today = new Date(item.createdAt).toDateString() === new Date().toDateString();
  return {
    id: item.id,
    peerUserId: item.peerUserId,
    name: item.peerDisplayName,
    country: item.peerCountryName ?? undefined,
    flag: flagOf(item.peerCountryCode),
    time: today ? when.toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" }) : callDateBucket(item.createdAt),
    missed: item.status === "MISSED",
    direction: item.direction === "INCOMING" ? "incoming" : "outgoing",
    kind: item.callType === "VIDEO" ? "video" : "audio",
    photoUrl: avatarUri(item.peerAvatarUrl),
  };
}


const FILTERS: Array<{ label: Filter; icon?: IoniconName }> = [
  { label: "All" },
  { label: "Missed" },
  { label: "Audio", icon: "call" },
  { label: "Video", icon: "videocam-outline" },
];

export default function CallsScreen() {
  useTranslation();
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width, 540);
  const scale = Math.min(1, pageWidth / 432);
  const [filter, setFilter] = useState<Filter>("All");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [historyItems, setHistoryItems] = useState<CallHistoryItem[]>([]);
  const history = useMemo(() => historyItems.map(toCall), [historyItems, i18n.language]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [zoom, setZoom] = useState<{ uri: string; name: string } | null>(null);
  const router = useRouter();
  const { profile } = useProfile();
  const myPhoto = avatarUri(profile?.avatarUrl);

  useEffect(() => {
    let alive = true;
    const service = new CallsService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
    service.listHistory(30).then((items) => { if (alive) setHistoryItems(items); }).catch(() => undefined).finally(() => { if (alive) setHistoryLoaded(true); });
    return () => { alive = false; };
  }, [profile?.id]);

  const visibleCalls = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return history.filter((call) => {
      const filterMatches =
        filter === "All" ||
        (filter === "Missed" && call.missed) ||
        (filter === "Audio" && call.kind === "audio") ||
        (filter === "Video" && call.kind === "video");
      return filterMatches && (!needle || call.name.toLowerCase().includes(needle));
    });
  }, [filter, query, history]);

  const [planner, setPlanner] = useState<PlannerMode | null>(null);
  const params = useLocalSearchParams<{ action?: string; request?: string }>();
  useEffect(() => { if (params.action === 'new') setPlanner('now'); }, [params.action, params.request]);
  const [scheduleVersion, setScheduleVersion] = useState(0);

  const startCall = (call: Call, kind: "audio" | "video") => {
    if (!call.peerUserId) return;
    void startSecureCallForPeer(call.peerUserId, kind === "video" ? "VIDEO" : "AUDIO").then((problem) => {
      if (problem) Alert.alert("Call", problem);
    });
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <SafeAreaView edges={["top", "left", "right"]} style={[styles.safeArea, { width: pageWidth }]}> 
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <Header
            photoUri={myPhoto}
            onPhoto={() => (myPhoto ? setZoom({ uri: myPhoto, name: "Your" }) : router.push("/account/manage" as never))}
            onSearch={() => setSearchOpen(true)}
            onSchedule={() => setPlanner("schedule")}
          />

          <Hero
            scale={scale}
            onNewCall={() => setPlanner("now")}
            onSchedule={() => setPlanner("schedule")}
          />

          <FilterBar selected={filter} onChange={setFilter} />

          <SectionTitle title="Upcoming" />
          <MyUpcoming fallback={<ScheduledCalls version={scheduleVersion} onSchedule={() => setPlanner("schedule")} />} />

          <View style={styles.recentHeading}>
            <SectionTitle title="Recent calls" compact />
            <Pressable onPress={() => { setFilter("All"); setQuery(""); }} hitSlop={12}>
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>

          <View style={styles.callList}>
            {visibleCalls.length ? (
              visibleCalls.map((call, index) => (
                <CallRow
                  key={call.id}
                  call={call}
                  last={index === visibleCalls.length - 1}
                  onAudio={() => startCall(call, "audio")}
                  onVideo={() => startCall(call, "video")}
                  onPhoto={() => call.photoUrl && setZoom({ uri: call.photoUrl, name: call.name })}
                />
              ))
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{historyLoaded ? "No calls match this filter." : "Loading calls…"}</Text>
              </View>
            )}
          </View>

          <RecordingsSection />

          <View style={styles.encryptionRow}>
            <Ionicons name="lock-closed-outline" size={17} color={COLORS.blue} />
            <Text style={styles.encryptionText}>End-to-end encrypted</Text>
          </View>
        </ScrollView>

      </SafeAreaView>

      <SearchModal
        visible={searchOpen}
        value={query}
        onChange={setQuery}
        onClose={() => setSearchOpen(false)}
      />
      <CallPlanner visible={planner !== null} initialMode={planner ?? "now"} onClose={() => setPlanner(null)} onScheduled={() => setScheduleVersion((v) => v + 1)} />
      <PhotoZoom uri={zoom?.uri} name={zoom?.name ?? ""} visible={!!zoom} onClose={() => setZoom(null)} />
    </View>
  );
}

function Header({ photoUri, onPhoto, onSearch, onSchedule }: { photoUri: string | null; onPhoto: () => void; onSearch: () => void; onSchedule: () => void }) {
  useTranslation();
  const { displayUri } = useAvatarImage(photoUri);
  return (
    <View style={styles.header}>
      <LinearGradient colors={["#10D8EA", "#0786FF"]} style={styles.brandMark}>
        <Ionicons name="link" size={29} color="#02152A" />
      </LinearGradient>
      <Text style={styles.headerTitle}>{t("Calls")}</Text>
      <View style={styles.headerSpacer} />
      <IconPressable icon="search-outline" label="Search calls" onPress={onSearch} size={29} />
      <IconPressable icon="calendar-outline" label="Scheduled calls" onPress={onSchedule} size={27} />
      <Pressable style={styles.profileRing} onPress={onPhoto} accessibilityRole="button" accessibilityLabel={photoUri ? "View your profile photo" : "Open profile"}>
        <Image source={displayUri ? { uri: displayUri } : AVATARS.profile} style={styles.profileImage} resizeMode="cover" />
      </Pressable>
    </View>
  );
}

function IconPressable({ icon, label, onPress, size = 24 }: { icon: IoniconName; label: string; onPress: () => void; size?: number }) {
  useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={size} color="#FFFFFF" />
    </Pressable>
  );
}

function Hero({ scale, onNewCall, onSchedule }: { scale: number; onNewCall: () => void; onSchedule: () => void }) {
  useTranslation();
  return (
    <LinearGradient
      colors={["#12347A", "#032950", "#151054"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.hero}
    >
      <View style={styles.heroGlow} />
      <View style={styles.orbitOne} />
      <View style={styles.orbitTwo} />
      <View style={styles.globe}>
        <LinearGradient colors={["#073BBD", "#041D76", "#27087A"]} style={styles.globeFill}>
          <Ionicons name="earth" size={84 * scale} color="#078AFF" />
          <View style={styles.globeGridH} />
          <View style={styles.globeGridV} />
        </LinearGradient>
      </View>
      <View style={[styles.spark, styles.sparkOne]} />
      <View style={[styles.spark, styles.sparkTwo]} />
      <View style={[styles.spark, styles.sparkThree]} />

      <Text style={styles.heroTitle}>Connect instantly</Text>
      <Text style={styles.heroSubtitle}>Secure audio, video, and group calls</Text>

      <View style={styles.heroActions}>
        <Pressable style={styles.newCallWrap} onPress={onNewCall}>
          <LinearGradient colors={["#12C8ED", "#087BFF"]} style={styles.heroButton}>
            <View style={styles.callIconWrap}>
              <Ionicons name="call" size={21} color="#FFFFFF" />
              <Ionicons name="add" size={14} color="#FFFFFF" style={styles.callPlus} />
            </View>
            <Text style={styles.heroButtonText}>New call</Text>
          </LinearGradient>
        </Pressable>
        <Pressable style={styles.scheduleButton} onPress={onSchedule}>
          <Ionicons name="calendar-outline" size={22} color="#FFFFFF" />
          <Text style={styles.heroButtonText}>Schedule</Text>
        </Pressable>
      </View>
      <Ionicons name="shield-checkmark-outline" size={28} color="#4772FF" style={styles.heroShield} />
    </LinearGradient>
  );
}

function FilterBar({ selected, onChange }: { selected: Filter; onChange: (filter: Filter) => void }) {
  useTranslation();
  return (
    <View style={styles.filterFrame}>
      <View style={styles.rule} />
      <View style={styles.filterRow}>
        {FILTERS.map(({ label, icon }) => {
          const active = selected === label;
          return (
            <Pressable key={label} onPress={() => onChange(label)} style={[styles.filterChip, active && styles.filterChipActive]}>
              {icon ? <Ionicons name={icon} size={18} color={active ? "#FFFFFF" : COLORS.muted} /> : null}
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.rule} />
    </View>
  );
}

function SectionTitle({ title, compact = false }: { title: string; compact?: boolean }) {
  useTranslation();
  return <Text style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}>{title}</Text>;
}

/** What this person added to Linqa from chats; the sample card below only shows while there is nothing of their own. */
function MyUpcoming({ fallback }: { fallback: React.ReactElement }) {
  useTranslation();
  const router = useRouter();
  const { items } = useMyEvents();
  const next = upcomingOf(items).slice(0, 3);
  if (next.length === 0) return fallback;
  return (
    <View>
      {next.map((e) => {
        const d = new Date(e.startsAt);
        return (
          <Pressable key={e.id} onPress={() => router.push("/event-log" as never)} accessibilityRole="button" accessibilityLabel={`${e.kind === "meeting" ? "Meeting" : "Event"}: ${e.title}. Open the event log`} style={{ marginBottom: 8 }}>
            <View style={styles.upcomingCard}>
              <View style={[styles.groupAvatar, { backgroundColor: "#245EDA", alignItems: "center", justifyContent: "center" }]}>
                <Ionicons name={e.kind === "meeting" ? "videocam" : "calendar"} size={30} color="#FFFFFF" />
              </View>
              <View style={styles.upcomingCopy}>
                <Text style={styles.upcomingTitle} numberOfLines={2}>{e.title}</Text>
                <Text style={styles.upcomingTime}>{d.toLocaleDateString(i18n.language, { weekday: "short", month: "short", day: "numeric" })} · {d.toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" })}</Text>
                {e.place ? <Text style={[styles.upcomingTime, { color: "#94A3B8" }]} numberOfLines={1}>{e.place}</Text> : null}
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function ScheduledCalls({ version, onSchedule }: { version: number; onSchedule: () => void }) {
  useTranslation();
  const [items, setItems] = useState<ScheduledCall[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [, relock] = useState(0);
  useEffect(() => onJoinLockChange(() => relock((n) => n + 1)), []);
  useEffect(() => {
    let alive = true;
    const service = new CallsService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
    const load = () => service.listScheduled(10).then((rows) => { if (alive) setItems(rows.filter((r) => r.status === "SCHEDULED")); }).catch(() => { if (alive) setItems((now) => now ?? []); });
    void load();
    // The server owns the join window; asking again every 30 s opens the Join button on time.
    const timer = setInterval(() => void load(), 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [version, refresh]);

  const cancel = (id: string) => {
    const service = new CallsService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
    Alert.alert("Cancel this call?", "The people invited will no longer see it.", [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel call", style: "destructive", onPress: () => void service.cancelScheduled(id).then(() => setRefresh((n) => n + 1)).catch(() => Alert.alert("Not cancelled", "Try again.")) },
    ]);
  };

  const join = (call: ScheduledCall) => {
    void joinScheduledCallNow(call).then((problem) => { if (problem) Alert.alert("Call", problem); });
  };

  if (!items?.length) {
    return (
      <Pressable onPress={onSchedule} accessibilityRole="button" accessibilityLabel="Schedule a call">
        <View style={styles.upcomingCard}>
          <View style={[styles.groupAvatar, { backgroundColor: "#245EDA", alignItems: "center", justifyContent: "center" }]}>
            <Ionicons name="calendar-outline" size={30} color="#FFFFFF" />
          </View>
          <View style={styles.upcomingCopy}>
            <Text style={styles.upcomingTitle}>{items === null ? "Loading…" : "No calls scheduled"}</Text>
            <Text style={styles.upcomingTime}>Tap to schedule one</Text>
          </View>
        </View>
      </Pressable>
    );
  }
  return (
    <View>
      {items.slice(0, 3).map((c) => {
        const who = c.isOrganizer ? c.participantNames.join(", ") : c.organizerName;
        return (
          <View key={c.id} style={{ marginBottom: 8 }}>
            <View style={styles.upcomingCard}>
              <View style={[styles.groupAvatar, { backgroundColor: "#245EDA", alignItems: "center", justifyContent: "center" }]}>
                <Ionicons name={c.callType === "VIDEO" ? "videocam" : "call"} size={30} color="#FFFFFF" />
              </View>
              <View style={styles.upcomingCopy}>
                <Text style={styles.upcomingTitle} numberOfLines={2}>{c.callType === "VIDEO" ? "Video" : "Voice"} call with {who || "your contacts"}</Text>
                <Text style={styles.upcomingTime}>{formatScheduledFor(c.scheduledFor)}</Text>
              </View>
              <View style={{ alignItems: "center", gap: 8 }}>
                <Pressable onPress={() => join(c)} disabled={!c.joinable || isJoinLocked(c.id)} style={[styles.joinWrap, (!c.joinable || isJoinLocked(c.id)) && { opacity: 0.4 }]} accessibilityRole="button" accessibilityState={{ disabled: !c.joinable || isJoinLocked(c.id) }} accessibilityLabel={c.joinable ? "Join call" : "Join opens 10 minutes before the call"}>
                  <LinearGradient colors={["#11C9EC", "#0879FF"]} style={styles.joinButton}>
                    <Text style={styles.joinText}>{isJoinLocked(c.id) ? "Joining…" : "Join"}</Text>
                  </LinearGradient>
                </Pressable>
                {c.isOrganizer ? (
                  <Pressable onPress={() => cancel(c.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel scheduled call">
                    <Ionicons name="close-circle-outline" size={22} color={COLORS.muted} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function CallRow({ call, last, onAudio, onVideo, onPhoto }: { call: Call; last: boolean; onAudio: () => void; onVideo: () => void; onPhoto: () => void }) {
  useTranslation();
  const { width } = useWindowDimensions();
  const { displayUri } = useAvatarImage(call.photoUrl);
  const timeWidth = Math.min(100, Math.max(72, width * 0.23));
  return (
    <View style={[styles.callRow, !last && styles.callRowDivider]}>
      <View style={styles.avatarWrap}>
        <Pressable onPress={onPhoto} disabled={!displayUri} accessibilityRole="imagebutton" accessibilityLabel={`${call.name} photo`}>
          {displayUri ? (
            <Image source={{ uri: displayUri }} style={styles.callAvatar} resizeMode="cover" />
          ) : (
            <LinearGradient colors={["#2E47CE", "#5512A8"]} style={styles.callAvatarFallback}>
              <Text style={styles.callInitial}>{call.name.trim().charAt(0).toUpperCase() || "?"}</Text>
            </LinearGradient>
          )}
        </Pressable>
        <View style={[styles.directionBadge, call.missed && styles.directionBadgeMissed]}>
          <Ionicons
            name={call.direction === "outgoing" ? "arrow-up" : "arrow-down"}
            size={11}
            color="#FFFFFF"
            style={{ transform: [{ rotate: call.direction === "outgoing" ? "45deg" : "45deg" }] }}
          />
        </View>
      </View>

      <View style={styles.callCopy}>
        <Text numberOfLines={1} style={styles.callName}>{call.name}</Text>
        <View style={styles.countryLine}>
          {call.kind === "group" ? <Ionicons name="people-outline" size={17} color={COLORS.muted} /> : <Text style={styles.flag}>{call.flag}</Text>}
          <Text numberOfLines={1} style={styles.country}>{call.country}</Text>
        </View>
      </View>

      <View style={[styles.callTimeBlock, { width: timeWidth }]}>
        <Text style={[styles.callTime, call.missed && styles.callTimeMissed]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{call.time}</Text>
        <Ionicons name="lock-closed-outline" size={14} color={call.missed ? COLORS.red : COLORS.muted} style={styles.rowLock} />
      </View>

      <Pressable style={styles.roundAction} onPress={onAudio} accessibilityRole="button" accessibilityLabel={`Voice call ${call.name}`}>
        <Ionicons name="call" size={21} color="#FFFFFF" />
        
      </Pressable>
      {call.kind !== "audio" ? (
        <Pressable style={styles.videoAction} onPress={onVideo} accessibilityRole="button" accessibilityLabel={`Video call ${call.name}`}>
          <Ionicons name="videocam" size={20} color="#FFFFFF" />
        </Pressable>
      ) : <View style={styles.videoActionPlaceholder} />}
      <Pressable onPress={() => Alert.alert(call.name, "Call options") } hitSlop={8} style={styles.moreButton} accessibilityRole="button" accessibilityLabel={`More options for ${call.name}`}>
        <Ionicons name="ellipsis-horizontal" size={18} color={COLORS.muted} />
      </Pressable>
    </View>
  );
}

function SearchModal({ visible, value, onChange, onClose }: { visible: boolean; value: string; onChange: (text: string) => void; onClose: () => void }) {
  useTranslation();
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.searchPanel} onPress={() => undefined}>
          <Ionicons name="search" size={21} color={COLORS.muted} />
          <TextInput
            autoFocus
            value={value}
            onChangeText={onChange}
            placeholder="Search calls"
            placeholderTextColor="#7180A9"
            style={styles.searchInput}
            returnKeyType="search"
            onSubmitEditing={onClose}
          />
          <Pressable onPress={onClose}><Ionicons name="close" size={22} color="#FFFFFF" /></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background, alignItems: "center" },
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingBottom: 40 },
  pressed: { opacity: 0.76 },

  header: { height: 84, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 11 },
  brandMark: { width: 41, height: 41, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: COLORS.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.7, marginLeft: 2 },
  headerSpacer: { flex: 1 },
  headerIcon: { width: 38, height: 46, alignItems: "center", justifyContent: "center" },
  profileRing: { width: 39, height: 39, borderRadius: 12, padding: 1.5, borderWidth: 1.5, borderColor: COLORS.cyan },
  profileImage: { width: "100%", height: "100%", borderRadius: 9 },

  hero: { height: 165, marginHorizontal: 15, borderRadius: 17, borderWidth: 1, borderColor: "#283D82", overflow: "hidden", padding: 20 },
  heroGlow: { position: "absolute", right: 20, top: 10, width: 170, height: 150, borderRadius: 90, backgroundColor: "rgba(5,61,170,.16)" },
  orbitOne: { position: "absolute", width: 180, height: 68, right: 3, top: 30, borderRadius: 90, borderWidth: 0.6, borderColor: "#235CF0", transform: [{ rotate: "18deg" }] },
  orbitTwo: { position: "absolute", width: 164, height: 73, right: 6, top: 54, borderRadius: 90, borderWidth: 0.6, borderColor: "#4E32FF", transform: [{ rotate: "-18deg" }] },
  globe: { position: "absolute", right: 38, top: 16, width: 115, height: 115, borderRadius: 58, overflow: "hidden" },
  globeFill: { flex: 1, borderRadius: 58, borderWidth: 1, borderColor: "#126CFF", alignItems: "center", justifyContent: "center" },
  globeGridH: { position: "absolute", left: 5, right: 5, top: 56, borderTopWidth: 0.6, borderColor: "rgba(33,151,255,.7)" },
  globeGridV: { position: "absolute", top: 5, bottom: 5, left: 56, borderLeftWidth: 0.6, borderColor: "rgba(33,151,255,.7)" },
  spark: { position: "absolute", width: 4, height: 4, borderRadius: 2, backgroundColor: "#FFFFFF", shadowColor: "#1ABFFF", shadowOpacity: 1, shadowRadius: 5 },
  sparkOne: { right: 72, top: 34 }, sparkTwo: { right: 17, top: 48 }, sparkThree: { right: 81, top: 126 },
  heroTitle: { color: COLORS.text, fontSize: 21, lineHeight: 26, fontWeight: "800", letterSpacing: -0.5, zIndex: 2 },
  heroSubtitle: { color: "#C5D0EF", fontSize: 13.5, marginTop: 7, zIndex: 2 },
  heroActions: { position: "absolute", left: 20, bottom: 19, flexDirection: "row", gap: 8, zIndex: 3 },
  newCallWrap: { width: 105, height: 45, borderRadius: 10, overflow: "hidden" },
  heroButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 10 },
  scheduleButton: { width: 105, height: 45, borderRadius: 10, borderWidth: 1, borderColor: "#285695", backgroundColor: "rgba(4,35,74,.82)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  heroButtonText: { color: "#FFFFFF", fontSize: 13.5, fontWeight: "700" },
  // The plus badge is anchored to the phone icon, so it stays on the icon whatever width the button gets.
  callIconWrap: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  callPlus: { position: "absolute", right: -6, top: -5 },
  heroShield: { position: "absolute", right: 13, bottom: 10 },

  filterFrame: { marginTop: 8, paddingHorizontal: 10 },
  rule: { height: 2, borderRadius: 1, backgroundColor: "#EAF2FF" },
  filterRow: { height: 44, marginVertical: 5, flexDirection: "row", gap: 6 },
  filterChip: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 25, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  filterChipActive: { borderColor: COLORS.cyan, backgroundColor: "#0A2852" },
  filterText: { color: COLORS.muted, fontSize: 13.5 },
  filterTextActive: { color: "#FFFFFF" },

  sectionTitle: { color: COLORS.text, fontSize: 14.5, fontWeight: "700", marginHorizontal: 15, marginTop: 12, marginBottom: 9 },
  sectionTitleCompact: { marginHorizontal: 0, marginTop: 0, marginBottom: 0 },
  upcomingCard: { minHeight: 92, marginHorizontal: 15, borderRadius: 11, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface2, paddingHorizontal: 13, flexDirection: "row", alignItems: "center" },
  groupAvatar: { width: 61, height: 61, borderRadius: 14, borderWidth: 1, borderColor: "#3977FF", alignItems: "center", justifyContent: "center" },
  upcomingCopy: { flex: 1, marginLeft: 14 },
  upcomingTitle: { color: COLORS.text, fontSize: 14.5, fontWeight: "700" },
  upcomingTime: { color: "#72A4FF", fontSize: 12.5, marginTop: 4 },
  participants: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  participant: { width: 25, height: 25, borderRadius: 8, borderWidth: 1.5, borderColor: COLORS.surface2 },
  participantOverlap: { marginLeft: -4 },
  morePeople: { width: 25, height: 25, borderRadius: 8, backgroundColor: "#142A50", borderWidth: 1, borderColor: "#34496C", alignItems: "center", justifyContent: "center" },
  morePeopleText: { color: COLORS.muted, fontSize: 12 },
  joinWrap: { width: 80, height: 33, borderRadius: 10, overflow: "hidden" },
  joinButton: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  joinText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },

  recentHeading: { marginHorizontal: 15, marginTop: 18, marginBottom: 9, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  seeAll: { color: COLORS.cyan, fontSize: 13.5 },
  callList: { marginHorizontal: 15, borderRadius: 11, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, overflow: "hidden" },
  callRow: { minHeight: 65, paddingVertical: 9, flexDirection: "row", alignItems: "center", paddingHorizontal: 10 },
  callRowDivider: { borderBottomWidth: 1, borderBottomColor: "#1A2945" },
  avatarWrap: { width: 47, height: 47 },
  callAvatar: { width: 47, height: 47, borderRadius: 10, borderWidth: 1, borderColor: "#806C38" },
  callInitial: { color: "#FFFFFF", fontSize: 21, fontWeight: "700" },
  callAvatarFallback: { width: 47, height: 47, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  directionBadge: { position: "absolute", right: -1, bottom: -1, width: 17, height: 17, borderRadius: 9, backgroundColor: "#179460", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.surface },
  directionBadgeMissed: { backgroundColor: COLORS.red },
  callCopy: { flex: 1, minWidth: 0, marginLeft: 13 },
  callName: { color: COLORS.text, fontSize: 14, fontWeight: "700" },
  countryLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  flag: { fontSize: 13 },
  country: { color: COLORS.muted, fontSize: 12.5, flexShrink: 1 },
  callTimeBlock: { minWidth: 70, flexShrink: 0, alignItems: "center", paddingHorizontal: 4 },
  callTime: { color: COLORS.muted, fontSize: 12.5, textAlign: "center" },
  callTimeMissed: { color: COLORS.red },
  rowLock: { marginTop: 8 },
  roundAction: { width: 37, height: 37, borderRadius: 19, backgroundColor: "#13284E", borderWidth: 1, borderColor: "#273B65", alignItems: "center", justifyContent: "center", marginLeft: 2 },
  callSignal: { position: "absolute", right: 7, top: 7, transform: [{ rotate: "-45deg" }] },
  videoAction: { width: 39, height: 39, borderRadius: 20, backgroundColor: "#08A5F8", alignItems: "center", justifyContent: "center", marginLeft: 8 },
  videoActionPlaceholder: { width: 39, marginLeft: 8 },
  moreButton: { width: 25, height: 38, alignItems: "flex-end", justifyContent: "center", marginLeft: 4 },
  emptyState: { height: 80, alignItems: "center", justifyContent: "center" },
  emptyText: { color: COLORS.muted, fontSize: 13 },
  encryptionRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20 },
  encryptionText: { color: "#697DAE", fontSize: 12.5 },

  bottomNav: { position: "absolute", left: 0, right: 0, bottom: 0, height: 82, flexDirection: "row", backgroundColor: "#061027", borderTopWidth: 1, borderTopColor: "#172644", paddingBottom: Platform.OS === "ios" ? 8 : 4 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  navIndicator: { position: "absolute", top: 0, width: 41, height: 2, backgroundColor: COLORS.cyan },
  navLabel: { color: "#95A5D1", fontSize: 12.5 },
  navLabelActive: { color: COLORS.cyan },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.68)", paddingTop: 70, paddingHorizontal: 20 },
  searchPanel: { height: 54, borderRadius: 16, borderWidth: 1, borderColor: "#315184", backgroundColor: COLORS.surface2, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 15 },
  searchInput: { flex: 1, color: "#FFFFFF", fontSize: 16 },
});

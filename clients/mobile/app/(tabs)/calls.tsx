// Calls screen for the mobile app, displaying call history, scheduled calls, and contact interactions.
import React, { useMemo, useState } from "react";
import {
  Alert,
  Image,
  ImageSourcePropType,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "../../components/LinearGradient";
import { RecordingsSection } from "../../components/calls/RecordingsSection";
import { useRouter } from "expo-router";
import { upcomingOf, useMyEvents } from "../../services/my-events";

type Filter = "All" | "Missed" | "Audio" | "Video";
type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type Call = {
  id: string;
  name: string;
  country?: string;
  flag?: string;
  time: string;
  missed?: boolean;
  direction: "incoming" | "outgoing";
  kind: "audio" | "video" | "group";
  avatar?: ImageSourcePropType;
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
  michael: require("../../assets/avatars/michael.png"),
  ama: require("../../assets/avatars/ama.png"),
  david: require("../../assets/avatars/david.png"),
  p1: require("../../assets/avatars/p1.png"),
  p2: require("../../assets/avatars/p2.png"),
  p3: require("../../assets/avatars/p3.png"),
  p4: require("../../assets/avatars/p4.png"),
} satisfies Record<string, ImageSourcePropType>;

const CALLS: Call[] = [
  {
    id: "michael",
    name: "Michael Greene",
    country: "United States",
    flag: "🇺🇸",
    time: "9:20 AM",
    direction: "outgoing",
    kind: "video",
    avatar: AVATARS.michael,
  },
  {
    id: "ama",
    name: "Ama Mensah",
    country: "Ghana",
    flag: "🇬🇭",
    time: "Yesterday",
    direction: "incoming",
    kind: "video",
    avatar: AVATARS.ama,
  },
  {
    id: "david",
    name: "David Chen",
    country: "Singapore",
    flag: "🇸🇬",
    time: "Yesterday",
    missed: true,
    direction: "incoming",
    kind: "audio",
    avatar: AVATARS.david,
  },
  {
    id: "family",
    name: "Family Circle",
    country: "Group call",
    time: "May 18",
    direction: "outgoing",
    kind: "group",
  },
];

const FILTERS: Array<{ label: Filter; icon?: IoniconName }> = [
  { label: "All" },
  { label: "Missed" },
  { label: "Audio", icon: "call" },
  { label: "Video", icon: "videocam-outline" },
];

export default function CallsScreen() {
  const { width } = useWindowDimensions();
  const pageWidth = Math.min(width, 540);
  const scale = Math.min(1, pageWidth / 432);
  const [filter, setFilter] = useState<Filter>("All");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visibleCalls = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return CALLS.filter((call) => {
      const filterMatches =
        filter === "All" ||
        (filter === "Missed" && call.missed) ||
        (filter === "Audio" && call.kind === "audio") ||
        (filter === "Video" && call.kind === "video");
      return filterMatches && (!needle || call.name.toLowerCase().includes(needle));
    });
  }, [filter, query]);

  const startCall = (name = "a contact", kind: "audio" | "video" = "audio") => {
    Alert.alert(kind === "video" ? "Video call" : "New call", `Starting ${kind} call with ${name}.`);
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <SafeAreaView style={[styles.safeArea, { width: pageWidth }]}> 
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <Header
            onSearch={() => setSearchOpen(true)}
            onSchedule={() => Alert.alert("Schedule", "Open the call scheduler here.")}
          />

          <Hero
            scale={scale}
            onNewCall={() => startCall()}
            onSchedule={() => Alert.alert("Schedule call", "Choose contacts and a time.")}
          />

          <FilterBar selected={filter} onChange={setFilter} />

          <SectionTitle title="Upcoming" />
          <MyUpcoming fallback={<UpcomingCard onJoin={() => startCall("Global Team Sync", "video")} />} />

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
                  onAudio={() => startCall(call.name)}
                  onVideo={() => startCall(call.name, "video")}
                />
              ))
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No calls match this filter.</Text>
              </View>
            )}
          </View>

          <RecordingsSection />

          <View style={styles.encryptionRow}>
            <Ionicons name="lock-closed-outline" size={17} color={COLORS.blue} />
            <Text style={styles.encryptionText}>End-to-end encrypted</Text>
          </View>
        </ScrollView>

        <Pressable
          style={({ pressed }) => [styles.fabWrap, pressed && styles.pressed]}
          onPress={() => startCall()}
          accessibilityRole="button"
          accessibilityLabel="Start a new call"
        >
          <LinearGradient
            colors={["#08D4F2", "#0878FF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fab}
          >
            <Ionicons name="add" size={27} color="#FFFFFF" style={styles.fabPlus} />
            <Ionicons name="call" size={30} color="#FFFFFF" style={styles.fabPhone} />
          </LinearGradient>
        </Pressable>
      </SafeAreaView>

      <SearchModal
        visible={searchOpen}
        value={query}
        onChange={setQuery}
        onClose={() => setSearchOpen(false)}
      />
    </View>
  );
}

function Header({ onSearch, onSchedule }: { onSearch: () => void; onSchedule: () => void }) {
  return (
    <View style={styles.header}>
      <LinearGradient colors={["#10D8EA", "#0786FF"]} style={styles.brandMark}>
        <Ionicons name="link" size={29} color="#02152A" />
      </LinearGradient>
      <Text style={styles.headerTitle}>Calls</Text>
      <View style={styles.headerSpacer} />
      <IconPressable icon="search-outline" label="Search calls" onPress={onSearch} size={29} />
      <IconPressable icon="calendar-outline" label="Scheduled calls" onPress={onSchedule} size={27} />
      <Pressable style={styles.profileRing} onPress={() => Alert.alert("Profile")} accessibilityRole="button" accessibilityLabel="Open profile">
        <Image source={AVATARS.profile} style={styles.profileImage} />
      </Pressable>
    </View>
  );
}

function IconPressable({ icon, label, onPress, size = 24 }: { icon: IoniconName; label: string; onPress: () => void; size?: number }) {
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
            <Ionicons name="call" size={21} color="#FFFFFF" />
            <Ionicons name="add" size={16} color="#FFFFFF" style={styles.callPlus} />
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
  return <Text style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}>{title}</Text>;
}

/** What this person added to Linqa from chats; the sample card below only shows while there is nothing of their own. */
function MyUpcoming({ fallback }: { fallback: React.ReactElement }) {
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
                <Text style={styles.upcomingTime}>{d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</Text>
                {e.place ? <Text style={[styles.upcomingTime, { color: "#94A3B8" }]} numberOfLines={1}>{e.place}</Text> : null}
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function UpcomingCard({ onJoin }: { onJoin: () => void }) {
  const people = [AVATARS.p1, AVATARS.p2, AVATARS.p3, AVATARS.p4];
  return (
    <Pressable onPress={onJoin} accessibilityRole="button" accessibilityLabel="Join Global Team Sync call">
      <View style={styles.upcomingCard}>
        <LinearGradient colors={["#245EDA", "#172C9B"]} style={styles.groupAvatar}>
          <Ionicons name="people" size={33} color="#FFFFFF" />
        </LinearGradient>
        <View style={styles.upcomingCopy}>
          <Text style={styles.upcomingTitle}>Global Team Sync</Text>
          <Text style={styles.upcomingTime}>Today · 8:30 PM</Text>
          <View style={styles.participants}>
            {people.map((source, index) => (
              <Image key={index} source={source} style={[styles.participant, index > 0 && styles.participantOverlap]} />
            ))}
            <View style={[styles.morePeople, styles.participantOverlap]}><Text style={styles.morePeopleText}>+3</Text></View>
          </View>
        </View>
        <Pressable onPress={onJoin} style={styles.joinWrap}>
          <LinearGradient colors={["#11C9EC", "#0879FF"]} style={styles.joinButton}>
            <Text style={styles.joinText}>Join</Text>
          </LinearGradient>
        </Pressable>
      </View>
    </Pressable>
  );
}

function CallRow({ call, last, onAudio, onVideo }: { call: Call; last: boolean; onAudio: () => void; onVideo: () => void }) {
  return (
    <View style={[styles.callRow, !last && styles.callRowDivider]}>
      <View style={styles.avatarWrap}>
        {call.avatar ? (
          <Image source={call.avatar} style={styles.callAvatar} />
        ) : (
          <LinearGradient colors={["#2E47CE", "#5512A8"]} style={styles.callAvatarFallback}>
            <Ionicons name="people" size={27} color="#FFFFFF" />
          </LinearGradient>
        )}
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

      <View style={styles.callTimeBlock}>
        <Text style={[styles.callTime, call.missed && styles.callTimeMissed]}>{call.time}</Text>
        <Ionicons name="lock-closed-outline" size={14} color={call.missed ? COLORS.red : COLORS.muted} style={styles.rowLock} />
      </View>

      <Pressable style={styles.roundAction} onPress={onAudio} accessibilityRole="button" accessibilityLabel={`Voice call ${call.name}`}>
        <Ionicons name="call" size={21} color="#FFFFFF" />
        {call.id === "michael" ? <Ionicons name="wifi" size={8} color="#FFFFFF" style={styles.callSignal} /> : null}
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
  callPlus: { position: "absolute", left: 27, top: 8 },
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
  callRow: { height: 65, flexDirection: "row", alignItems: "center", paddingHorizontal: 10 },
  callRowDivider: { borderBottomWidth: 1, borderBottomColor: "#1A2945" },
  avatarWrap: { width: 47, height: 47 },
  callAvatar: { width: 47, height: 47, borderRadius: 10, borderWidth: 1, borderColor: "#806C38" },
  callAvatarFallback: { width: 47, height: 47, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  directionBadge: { position: "absolute", right: -1, bottom: -1, width: 17, height: 17, borderRadius: 9, backgroundColor: "#179460", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.surface },
  directionBadgeMissed: { backgroundColor: COLORS.red },
  callCopy: { flex: 1, minWidth: 0, marginLeft: 13 },
  callName: { color: COLORS.text, fontSize: 14, fontWeight: "700" },
  countryLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  flag: { fontSize: 13 },
  country: { color: COLORS.muted, fontSize: 12.5, flexShrink: 1 },
  callTimeBlock: { width: 62, alignItems: "center" },
  callTime: { color: COLORS.muted, fontSize: 12.5 },
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

  fabWrap: { position: "absolute", right: 21, bottom: 94, width: 63, height: 63, borderRadius: 32, overflow: "hidden", zIndex: 20, elevation: 12, shadowColor: COLORS.cyan, shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  fab: { flex: 1, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  fabPlus: { position: "absolute", left: 16, top: 12 },
  fabPhone: { marginTop: 10, marginLeft: 8 },
  bottomNav: { position: "absolute", left: 0, right: 0, bottom: 0, height: 82, flexDirection: "row", backgroundColor: "#061027", borderTopWidth: 1, borderTopColor: "#172644", paddingBottom: Platform.OS === "ios" ? 8 : 4 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  navIndicator: { position: "absolute", top: 0, width: 41, height: 2, backgroundColor: COLORS.cyan },
  navLabel: { color: "#95A5D1", fontSize: 12.5 },
  navLabelActive: { color: COLORS.cyan },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.68)", paddingTop: 70, paddingHorizontal: 20 },
  searchPanel: { height: 54, borderRadius: 16, borderWidth: 1, borderColor: "#315184", backgroundColor: COLORS.surface2, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 15 },
  searchInput: { flex: 1, color: "#FFFFFF", fontSize: 16 },
});

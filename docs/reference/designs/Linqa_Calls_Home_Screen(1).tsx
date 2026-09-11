import React, { memo, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  ListRenderItemInfo,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  CalendarDays,
  ChevronRight,
  Globe2,
  Home,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
  Search,
  Link,
  UserRound,
  UsersRound,
  Video,
} from "lucide-react-native";

type Filter = "All" | "Missed" | "Audio" | "Video";
type CallKind = "audio" | "video" | "group";
type CallDirection = "incoming" | "outgoing" | "missed";

export type CallRecord = {
  id: string;
  name: string;
  country?: string;
  flag?: string;
  avatar?: string;
  occurredAt: string;
  kind: CallKind;
  direction: CallDirection;
  encrypted: boolean;
};

export type ScheduledCall = {
  id: string;
  title: string;
  displayTime: string;
  participantAvatars: string[];
  remainingParticipants?: number;
};

export type CallsHomeScreenProps = {
  calls?: CallRecord[];
  scheduledCall?: ScheduledCall | null;
  profileAvatar?: string;
  onSearch?: () => void;
  onOpenCalendar?: () => void;
  onOpenProfile?: () => void;
  onNewCall?: () => void;
  onScheduleCall?: () => void;
  onJoinScheduledCall?: (call: ScheduledCall) => void;
  onStartAudioCall?: (call: CallRecord) => void;
  onStartVideoCall?: (call: CallRecord) => void;
  onOpenCallDetails?: (call: CallRecord) => void;
  onOpenAllCalls?: () => void;
  onNavigate?: (route: "Home" | "Calls" | "Chats" | "Community" | "Profile") => void;
};

const COLORS = {
  bg: "#020B20",
  panel: "#091630",
  panelSoft: "#0C1934",
  line: "#1D2A48",
  cyan: "#08C7F7",
  blue: "#1478FF",
  violet: "#6253F5",
  white: "#F7FAFF",
  secondary: "#AAB6D5",
  muted: "#7381A6",
  green: "#22C97A",
  red: "#FF5A68",
};

const SAMPLE_CALLS: CallRecord[] = [
  {
    id: "call-michael",
    name: "Michael Greene",
    country: "United States",
    flag: "🇺🇸",
    avatar: "https://i.pravatar.cc/180?img=12",
    occurredAt: "9:20 AM",
    kind: "video",
    direction: "outgoing",
    encrypted: true,
  },
  {
    id: "call-ama",
    name: "Ama Mensah",
    country: "Ghana",
    flag: "🇬🇭",
    avatar: "https://i.pravatar.cc/180?img=47",
    occurredAt: "Yesterday",
    kind: "audio",
    direction: "incoming",
    encrypted: true,
  },
  {
    id: "call-david",
    name: "David Chen",
    country: "Singapore",
    flag: "🇸🇬",
    avatar: "https://i.pravatar.cc/180?img=11",
    occurredAt: "Yesterday",
    kind: "audio",
    direction: "missed",
    encrypted: true,
  },
  {
    id: "call-family",
    name: "Family Circle",
    occurredAt: "May 18",
    kind: "group",
    direction: "incoming",
    encrypted: true,
  },
];

const SAMPLE_SCHEDULED_CALL: ScheduledCall = {
  id: "global-team-sync",
  title: "Global Team Sync",
  displayTime: "Today · 8:30 PM",
  participantAvatars: [
    "https://i.pravatar.cc/96?img=5",
    "https://i.pravatar.cc/96?img=13",
    "https://i.pravatar.cc/96?img=32",
    "https://i.pravatar.cc/96?img=12",
  ],
  remainingParticipants: 3,
};

const IconButton = memo(function IconButton({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
});

function LinqaMark() {
  return (
    <LinearGradient colors={[COLORS.cyan, COLORS.blue]} style={styles.logo}>
      <Link color="#00172A" size={27} strokeWidth={2.5} />
    </LinearGradient>
  );
}

function Hero({
  onNewCall,
  onScheduleCall,
}: Pick<CallsHomeScreenProps, "onNewCall" | "onScheduleCall">) {
  return (
    <LinearGradient
      colors={["#112B72", "#073A72", "#171054"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.hero}
    >
      <View style={styles.heroGlow} />
      <View style={styles.heroTitleRow}>
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>Connect instantly</Text>
          <Text style={styles.heroSubtitle}>Secure audio, video, and group calls</Text>
        </View>
        <View style={styles.globeCircle}>
          <Globe2 color="#368CFF" size={126} strokeWidth={0.7} />
        </View>
      </View>
      <View style={styles.heroActions}>
        <Pressable onPress={onNewCall} style={({ pressed }) => [styles.primaryButtonWrap, pressed && styles.pressed]}>
          <LinearGradient colors={[COLORS.cyan, COLORS.blue]} style={styles.primaryButton}>
            <PhoneCall color="white" size={20} />
            <Text style={styles.primaryButtonText}>New call</Text>
          </LinearGradient>
        </Pressable>
        <Pressable onPress={onScheduleCall} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <CalendarDays color={COLORS.white} size={20} />
          <Text style={styles.secondaryButtonText}>Schedule</Text>
        </Pressable>
      </View>
      <LockKeyhole color="#5F88FF" size={17} style={styles.heroLock} />
    </LinearGradient>
  );
}

function FilterBar({ selected, onSelect }: { selected: Filter; onSelect: (filter: Filter) => void }) {
  const filters: Filter[] = ["All", "Missed", "Audio", "Video"];
  return (
    <View style={styles.filters} accessibilityRole="tablist">
      {filters.map((filter) => {
        const active = filter === selected;
        return (
          <Pressable
            key={filter}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(filter)}
            style={({ pressed }) => [styles.filter, active && styles.filterActive, pressed && styles.pressed]}
          >
            {filter === "Audio" && <Phone color={active ? COLORS.cyan : COLORS.secondary} size={15} />}
            {filter === "Video" && <Video color={active ? COLORS.cyan : COLORS.secondary} size={16} />}
            <Text style={[styles.filterText, active && styles.filterTextActive]}>{filter}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function UpcomingCard({ call, onJoin }: { call: ScheduledCall; onJoin?: (call: ScheduledCall) => void }) {
  return (
    <View style={styles.upcomingCard}>
      <LinearGradient colors={["#174AB0", "#3924A6"]} style={styles.groupAvatar}>
        <UsersRound color="white" size={28} />
      </LinearGradient>
      <View style={styles.upcomingBody}>
        <Text style={styles.upcomingTitle} numberOfLines={1}>{call.title}</Text>
        <Text style={styles.upcomingTime}>{call.displayTime}</Text>
        <View style={styles.avatarStack}>
          {call.participantAvatars.slice(0, 4).map((uri, index) => (
            <Image key={`${uri}-${index}`} source={{ uri }} style={[styles.miniAvatar, index > 0 && { marginLeft: -7 }]} />
          ))}
          {!!call.remainingParticipants && (
            <View style={[styles.moreParticipants, { marginLeft: -5 }]}>
              <Text style={styles.moreParticipantsText}>+{call.remainingParticipants}</Text>
            </View>
          )}
        </View>
      </View>
      <Pressable onPress={() => onJoin?.(call)} style={({ pressed }) => [styles.joinWrap, pressed && styles.pressed]}>
        <LinearGradient colors={[COLORS.cyan, COLORS.blue]} style={styles.joinButton}>
          <Text style={styles.joinText}>Join</Text>
          <ChevronRight color="white" size={16} />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

function DirectionIcon({ direction }: { direction: CallDirection }) {
  if (direction === "missed") return <PhoneMissed color={COLORS.red} size={14} />;
  if (direction === "outgoing") return <PhoneOutgoing color={COLORS.green} size={14} />;
  return <PhoneIncoming color={COLORS.green} size={14} />;
}

const CallRow = memo(function CallRow({
  item,
  onAudio,
  onVideo,
  onDetails,
  first,
  last,
}: {
  item: CallRecord;
  onAudio?: (call: CallRecord) => void;
  onVideo?: (call: CallRecord) => void;
  onDetails?: (call: CallRecord) => void;
  first: boolean;
  last: boolean;
}) {
  const missed = item.direction === "missed";
  return (
    <View style={[styles.callRow, first && styles.firstRow, last && styles.lastRow]}>
      <View style={styles.avatarWrap}>
        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.avatar} />
        ) : (
          <LinearGradient colors={["#343ED7", "#7B21CA"]} style={styles.avatarFallback}>
            <UsersRound color="white" size={23} />
          </LinearGradient>
        )}
        <View style={[styles.directionBadge, missed && styles.directionBadgeMissed]}>
          <DirectionIcon direction={item.direction} />
        </View>
      </View>
      <View style={styles.callIdentity}>
        <Text style={styles.callName} numberOfLines={1}>{item.name}</Text>
        <View style={styles.callMetaRow}>
          <Text style={styles.countryText} numberOfLines={1}>
            {item.kind === "group" ? "Group call" : `${item.flag ?? ""} ${item.country ?? ""}`.trim()}
          </Text>
        </View>
        <Text style={[styles.callTime, missed && styles.missedText]} numberOfLines={1}>{item.occurredAt}</Text>
      </View>
      <View style={styles.callTimeWrap}>
        {item.encrypted && <LockKeyhole color={missed ? COLORS.red : COLORS.secondary} size={12} />}
      </View>
      <IconButton accessibilityLabel={`Audio call ${item.name}`} onPress={() => onAudio?.(item)}>
        <Phone color={COLORS.white} size={19} />
      </IconButton>
      <View style={styles.videoSlot}>
      {item.kind !== "audio" && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Video call ${item.name}`}
          onPress={() => onVideo?.(item)}
          style={({ pressed }) => [styles.videoButton, pressed && styles.pressed]}
        >
          <Video color="white" size={20} fill="white" />
        </Pressable>
      )}
      </View>
      <Pressable hitSlop={8} accessibilityLabel={`More options for ${item.name}`} onPress={() => onDetails?.(item)}>
        <MoreHorizontal color={COLORS.secondary} size={20} />
      </Pressable>
    </View>
  );
});

function BottomNavigation({ onNavigate }: Pick<CallsHomeScreenProps, "onNavigate">) {
  const items = [
    { name: "Home" as const, Icon: Home },
    { name: "Calls" as const, Icon: Phone },
    { name: "Chats" as const, Icon: MessageCircle },
    { name: "Community" as const, Icon: UsersRound },
    { name: "Profile" as const, Icon: UserRound },
  ];
  return (
    <View style={styles.bottomNav}>
      {items.map(({ name, Icon }) => {
        const active = name === "Calls";
        return (
          <Pressable key={name} onPress={() => onNavigate?.(name)} style={styles.navItem}>
            {active && <View style={styles.navIndicator} />}
            <Icon color={active ? COLORS.cyan : COLORS.secondary} size={22} fill={active ? COLORS.cyan : "transparent"} />
            <Text style={[styles.navLabel, active && styles.navLabelActive]}>{name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function CallsHomeScreen(props: CallsHomeScreenProps) {
  const [filter, setFilter] = useState<Filter>("All");
  const calls = props.calls ?? SAMPLE_CALLS;
  const scheduledCall = props.scheduledCall === undefined ? SAMPLE_SCHEDULED_CALL : props.scheduledCall;

  const filteredCalls = useMemo(() => calls.filter((call) => {
    if (filter === "All") return true;
    if (filter === "Missed") return call.direction === "missed";
    if (filter === "Audio") return call.kind === "audio";
    return call.kind === "video" || call.kind === "group";
  }), [calls, filter]);

  const renderCall = ({ item, index }: ListRenderItemInfo<CallRecord>) => (
    <CallRow
      item={item}
      first={index === 0}
      last={index === filteredCalls.length - 1}
      onAudio={props.onStartAudioCall}
      onVideo={props.onStartVideoCall}
      onDetails={props.onOpenCallDetails}
    />
  );

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <View style={styles.header}>
        <LinqaMark />
        <Text style={styles.pageTitle}>Calls</Text>
        <View style={styles.headerSpacer} />
        <IconButton accessibilityLabel="Search calls" onPress={props.onSearch}>
          <Search color={COLORS.white} size={23} />
        </IconButton>
        <IconButton accessibilityLabel="Open call calendar" onPress={props.onOpenCalendar}>
          <CalendarDays color={COLORS.white} size={23} />
        </IconButton>
        <Pressable accessibilityLabel="Open profile" onPress={props.onOpenProfile} style={styles.profileButton}>
          {props.profileAvatar ? (
            <Image source={{ uri: props.profileAvatar }} style={styles.profileImage} />
          ) : (
            <UserRound color={COLORS.white} size={21} />
          )}
        </Pressable>
      </View>

      <FlatList
        data={filteredCalls}
        keyExtractor={(item) => item.id}
        renderItem={renderCall}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
        ListHeaderComponent={(
          <>
            <Hero onNewCall={props.onNewCall} onScheduleCall={props.onScheduleCall} />
            <FilterBar selected={filter} onSelect={setFilter} />
            {scheduledCall && (
              <>
                <Text style={styles.sectionTitle}>Upcoming</Text>
                <UpcomingCard call={scheduledCall} onJoin={props.onJoinScheduledCall} />
              </>
            )}
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionTitle}>Recent calls</Text>
              <Pressable onPress={props.onOpenAllCalls} hitSlop={8}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            </View>
          </>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <Phone color={COLORS.muted} size={30} />
            <Text style={styles.emptyTitle}>No calls in this category</Text>
            <Text style={styles.emptyCopy}>Try another filter or start a secure call.</Text>
          </View>
        )}
        ListFooterComponent={(
          <View style={styles.encryptionNote}>
            <LockKeyhole color={COLORS.blue} size={15} />
            <Text style={styles.encryptionText}>End-to-end encrypted</Text>
          </View>
        )}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start a new call"
        onPress={props.onNewCall}
        style={({ pressed }) => [styles.fabWrap, pressed && styles.pressed]}
      >
        <LinearGradient colors={[COLORS.cyan, COLORS.blue]} style={styles.fab}>
          <Plus color="white" size={19} strokeWidth={3} style={styles.fabPlus} />
          <Phone color="white" size={25} fill="white" />
        </LinearGradient>
      </Pressable>
      <BottomNavigation onNavigate={props.onNavigate} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingHorizontal: 15, paddingBottom: 86 },
  header: { height: 76, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 6 },
  logo: { width: 41, height: 41, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  logoGlyph: { color: "#00172A", fontSize: 31, fontWeight: "900", transform: [{ rotate: "-12deg" }] },
  pageTitle: { color: COLORS.white, fontSize: 30, fontWeight: "800", marginLeft: 3 },
  headerSpacer: { flex: 1 },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#12203E", alignItems: "center", justifyContent: "center" },
  profileButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: COLORS.cyan, overflow: "hidden", backgroundColor: COLORS.panel, alignItems: "center", justifyContent: "center" },
  profileImage: { width: "100%", height: "100%" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  hero: { borderRadius: 20, minHeight: 164, padding: 18, overflow: "hidden", borderWidth: 1, borderColor: "#304187" },
  heroGlow: { position: "absolute", width: 190, height: 190, borderRadius: 95, right: -48, top: -44, backgroundColor: "rgba(38,92,255,0.17)" },
  heroTitleRow: { flexDirection: "row", alignItems: "center" },
  heroCopy: { flex: 1, zIndex: 1 },
  heroTitle: { color: COLORS.white, fontSize: 23, lineHeight: 29, fontWeight: "800" },
  heroSubtitle: { color: "#D0DAF5", fontSize: 13, lineHeight: 18, marginTop: 5, maxWidth: 215 },
  globeCircle: { position: "absolute", right: -15, top: -9, width: 140, height: 140, borderRadius: 70, opacity: 0.35, borderWidth: 1, borderColor: "#4773C8", alignItems: "center", justifyContent: "center" },
  heroActions: { flexDirection: "row", gap: 8, marginTop: 22, maxWidth: 290 },
  primaryButtonWrap: { flex: 1 },
  primaryButton: { height: 51, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  primaryButtonText: { color: "white", fontSize: 16, fontWeight: "800" },
  secondaryButton: { flex: 1, height: 51, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: "rgba(6,25,61,0.8)", borderWidth: 1, borderColor: "#285692" },
  secondaryButtonText: { color: COLORS.white, fontSize: 16, fontWeight: "700" },
  heroLock: { position: "absolute", right: 15, bottom: 14 },
  filters: { flexDirection: "row", gap: 6, marginTop: 15, marginBottom: 1 },
  filter: { flex: 1, height: 42, borderRadius: 22, borderWidth: 1, borderColor: COLORS.line, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: "#07132B" },
  filterActive: { borderColor: COLORS.cyan, backgroundColor: "#09264A" },
  filterText: { color: COLORS.secondary, fontSize: 13, fontWeight: "600" },
  filterTextActive: { color: COLORS.white },
  sectionTitle: { color: COLORS.white, fontSize: 17, fontWeight: "700", marginTop: 20, marginBottom: 10 },
  upcomingCard: { minHeight: 94, borderRadius: 13, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.panelSoft, padding: 12, flexDirection: "row", alignItems: "center" },
  groupAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#527CFF" },
  upcomingBody: { flex: 1, minWidth: 0, marginLeft: 10 },
  upcomingTitle: { color: COLORS.white, fontSize: 16, fontWeight: "800" },
  upcomingTime: { color: "#77A8FF", fontSize: 13, marginTop: 3 },
  avatarStack: { flexDirection: "row", marginTop: 10, alignItems: "center" },
  miniAvatar: { width: 25, height: 25, borderRadius: 13, borderWidth: 1.5, borderColor: COLORS.panelSoft },
  moreParticipants: { width: 25, height: 25, borderRadius: 13, borderWidth: 1, borderColor: "#3C4B71", backgroundColor: "#142241", alignItems: "center", justifyContent: "center" },
  moreParticipantsText: { color: COLORS.secondary, fontSize: 10, fontWeight: "700" },
  joinWrap: { marginLeft: 8 },
  joinButton: { minWidth: 76, height: 42, borderRadius: 13, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
  joinText: { color: "white", fontSize: 15, fontWeight: "800" },
  sectionHeadingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  seeAll: { color: COLORS.cyan, fontSize: 14, fontWeight: "700", marginTop: 13 },
  listCardStart: { height: 1, backgroundColor: COLORS.line, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  callRow: { minHeight: 78, paddingHorizontal: 10, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.panelSoft, borderLeftWidth: 1, borderRightWidth: 1, borderColor: COLORS.line },
  firstRow: { borderTopLeftRadius: 13, borderTopRightRadius: 13, borderTopWidth: 1 },
  lastRow: { borderBottomLeftRadius: 13, borderBottomRightRadius: 13, borderBottomWidth: 1 },
  rowDivider: { height: 1, backgroundColor: COLORS.line },
  avatarWrap: { width: 44, height: 44 },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: "#314668" },
  avatarFallback: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  directionBadge: { position: "absolute", right: -2, bottom: -1, width: 21, height: 21, borderRadius: 11, backgroundColor: "#153D32", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: COLORS.panelSoft },
  directionBadgeMissed: { backgroundColor: "#572331" },
  callIdentity: { flex: 1, minWidth: 0 },
  callName: { color: COLORS.white, fontSize: 14, fontWeight: "700" },
  callMetaRow: { flexDirection: "row", marginTop: 5 },
  countryText: { color: COLORS.secondary, fontSize: 12 },
  callTimeWrap: { width: 12, alignItems: "center" },
  callTime: { color: COLORS.secondary, fontSize: 10, marginTop: 3 },
  videoSlot: { width: 42 },
  missedText: { color: COLORS.red },
  videoButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.blue },
  encryptionNote: { height: 62, backgroundColor: COLORS.bg, flexDirection: "row", gap: 7, justifyContent: "center", alignItems: "center" },
  encryptionText: { color: COLORS.muted, fontSize: 13 },
  emptyState: { backgroundColor: COLORS.panelSoft, padding: 28, alignItems: "center", borderBottomLeftRadius: 18, borderBottomRightRadius: 18 },
  emptyTitle: { color: COLORS.white, fontSize: 15, fontWeight: "700", marginTop: 10 },
  emptyCopy: { color: COLORS.secondary, fontSize: 12, marginTop: 4 },
  fabWrap: { position: "absolute", right: 21, bottom: 94, zIndex: 10 },
  fab: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center", shadowColor: COLORS.cyan, shadowOpacity: 0.32, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  fabPlus: { position: "absolute", top: 12, left: 14 },
  bottomNav: { height: 74, flexDirection: "row", backgroundColor: "#061027", borderTopWidth: 1, borderTopColor: COLORS.line, paddingBottom: 7 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 5 },
  navIndicator: { position: "absolute", top: 0, width: 48, height: 3, backgroundColor: COLORS.cyan, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  navLabel: { color: COLORS.secondary, fontSize: 11 },
  navLabelActive: { color: COLORS.cyan, fontWeight: "700" },
});

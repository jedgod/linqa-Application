import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  CHAT_FILTERS,
  ChatInboxService,
  chatTimeLabel,
  deduplicateConversations,
  scheduledCallLabel,
  scheduledCallWhen,
  type ChatFilter,
  type ChatInboxPayload,
  type ChatSummary,
  type PresenceContact
} from "../../services/chat-inbox.service";
import { CallsService } from "../../services/calls.service";
import { ChatRealtimeClient, TypingRegistry } from "../../services/chat-realtime.client";
import { MobileHubService, type HubContact } from "../../services/mobile-hub.service";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";
import { getApiBaseUrl } from "../../config/api";

const API = getApiBaseUrl();

/** Chats runs on the dark surface from the approved design. */
const C = {
  bg: "#031824",
  card: "#082335",
  card2: "#0A2940",
  border: "#14536A",
  divider: "#0F3548",
  teal: "#13D7B0",
  cyan: "#47C9E8",
  white: "#F7FAFC",
  muted: "#91A7B8",
  blue: "#4586FF",
  purple: "#BB54EA",
  red: "#FF5D67"
} as const;

const FILTER_LABELS: Record<ChatFilter, string> = {
  all: "All",
  unread: "Unread",
  groups: "Groups",
  pinned: "Pinned"
};

/** Gradient pairs for initial avatars, picked deterministically from the id. */
const AVATAR_GRADIENTS: Array<[string, string]> = [
  ["#F47A54", "#C83DD4"],
  ["#B9D948", "#5FBF3A"],
  ["#C455F0", "#7B3FE4"],
  ["#FF6F7D", "#E8425C"],
  ["#4FB6F5", "#3D63E4"],
  ["#25C9A6", "#12857A"]
];

function gradientFor(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]!;
}

function Avatar({
  seed,
  initials,
  size = 54,
  online = false,
  ring
}: {
  seed: string;
  initials: string;
  size?: number;
  online?: boolean;
  ring?: string;
}) {
  const [from, to] = gradientFor(seed);
  return (
    <View style={ring ? [s.avatarRing, { borderColor: ring, borderRadius: size / 2 + 5 }] : undefined}>
      <LinearGradient
        colors={[from, to]}
        style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <Text style={[s.avatarText, { fontSize: size * 0.34 }]}>{initials || "?"}</Text>
      </LinearGradient>
      {online ? <View style={[s.onlineDot, { right: size * 0.02, bottom: size * 0.02 }]} /> : null}
    </View>
  );
}

/** Overlapping initial circles for a group row, as in the design. */
function GroupAvatar({ seed, members }: { seed: string; members: string[] }) {
  const shown = members.slice(0, 3);
  if (shown.length === 0) return <Avatar seed={seed} initials="#" />;
  return (
    <View style={s.groupAvatar}>
      {shown.map((initials, index) => {
        const [from, to] = gradientFor(`${seed}-${initials}-${index}`);
        return (
          <LinearGradient
            key={`${initials}-${index}`}
            colors={[from, to]}
            style={[
              s.groupAvatarPiece,
              index === 0 && { top: 0, left: 0 },
              index === 1 && { top: 0, right: 0 },
              index === 2 && { bottom: 0, alignSelf: "center" }
            ]}
          >
            <Text style={s.groupAvatarText}>{initials}</Text>
          </LinearGradient>
        );
      })}
    </View>
  );
}

function HeaderButton({
  label,
  icon,
  onPress,
  primary = false,
  dot = false
}: {
  label: string;
  icon: string;
  onPress: () => void;
  primary?: boolean;
  dot?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.headerButton, primary && s.headerButtonPrimary, pressed && s.pressed]}
    >
      <Ionicons name={icon as never} size={21} color={primary ? C.bg : C.white} />
      {dot ? <View style={s.headerDot} /> : null}
    </Pressable>
  );
}

export default function ChatsScreen() {
  const router = useRouter();
  const inbox = useMemo(
    () => new ChatInboxService(API, () => accessTokenProvider.getAccessToken()),
    []
  );
  const calls = useMemo(
    () => new CallsService(API, () => accessTokenProvider.getAccessToken()),
    []
  );
  const hub = useMemo(
    () => new MobileHubService(API, () => accessTokenProvider.getAccessToken()),
    []
  );

  const [filter, setFilter] = useState<ChatFilter>("all");
  const [data, setData] = useState<ChatInboxPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [contacts, setContacts] = useState<HubContact[]>([]);
  const [typingIn, setTypingIn] = useState<Set<string>>(new Set());
  const mounted = useRef(true);

  const realtime = useMemo(
    () => new ChatRealtimeClient(API, () => accessTokenProvider.getAccessToken()),
    []
  );

  const load = useCallback(
    async (signal?: AbortSignal, quiet = false) => {
      if (!quiet) setError(null);
      try {
        const result = await inbox.inbox(filter, signal);
        if (!mounted.current || signal?.aborted) return;
        setData({ ...result, conversations: deduplicateConversations(result.conversations) });
        setError(null);
      } catch (cause) {
        if (signal?.aborted || !mounted.current) return;
        setError(cause instanceof Error ? cause.message : "Unable to load chats.");
      } finally {
        if (mounted.current && !signal?.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [inbox, filter]
  );

  useEffect(() => {
    mounted.current = true;
    // Changing filter aborts the previous request, so a slow "All" response
    // cannot land after the user has already switched to "Unread".
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [load]);

  /**
   * Live inbox.
   *
   * A durable event triggers a refetch rather than patching the row in place:
   * the inbox carries counts and ordering the client would have to recompute,
   * and getting that subtly wrong is worse than one extra request. Typing is
   * applied directly, because it is ephemeral and has nothing to reconcile.
   */
  useEffect(() => {
    const typing = new TypingRegistry((ids) => {
      if (mounted.current) setTypingIn(ids);
    });

    const unsubscribe = realtime.onEvent((event) => {
      if (!mounted.current) return;
      if (event.type === "message.created" || event.type === "conversation.read") {
        void load(undefined, true);
        return;
      }
      if (event.type === "typing.start") {
        typing.start(event.conversationId, event.expiresInSeconds ?? 5);
      } else if (event.type === "typing.stop") {
        typing.stop(event.conversationId);
      }
    });

    void realtime.start();
    return () => {
      unsubscribe();
      typing.clear();
      realtime.stop();
    };
  }, [realtime, load]);

  // Watch exactly the conversations currently on screen.
  useEffect(() => {
    const ids = (data?.conversations ?? []).map((row) => row.conversationId);
    if (ids.length) realtime.setConversations(ids);
  }, [realtime, data?.conversations]);

  const counts = data?.counts ?? { all: 0, unread: 0, groups: 0, pinned: 0 };
  const conversations = data?.conversations ?? [];
  const scheduledCall = data?.scheduledCall ?? null;

  async function openConversation(item: ChatSummary) {
    // Revalidate membership before navigating. A row can be stale after a
    // block/removal event; navigating after this request fails would reopen a
    // conversation the server has already withdrawn.
    try {
      await inbox.markRead(item.conversationId);
      if (item.unreadCount > 0) {
        setData((current) =>
          current
            ? {
                ...current,
                unreadTotal: Math.max(0, current.unreadTotal - item.unreadCount),
                counts: { ...current.counts, unread: Math.max(0, current.counts.unread - 1) },
                conversations: current.conversations.map((row) =>
                  row.conversationId === item.conversationId ? { ...row, unreadCount: 0 } : row
                )
              }
            : current
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That conversation is no longer available.");
      void load(undefined, true);
      return;
    }
    router.push({ pathname: "/modules/conversation", params: { conversationId: item.conversationId } });
  }

  async function openCompose() {
    setHubOpen(false);
    setComposeOpen(true);
    try {
      const snapshot = await hub.loadHub();
      if (mounted.current) setContacts(snapshot.contacts);
    } catch {
      if (mounted.current) setContacts([]);
    }
  }

  async function startConversation(contact: HubContact) {
    try {
      await hub.createConversation(contact.id);
      setComposeOpen(false);
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start that conversation.");
    }
  }

  async function joinScheduledCall() {
    if (!scheduledCall) return;
    try {
      await calls.joinScheduledCall(scheduledCall.eventId);
      go("/(tabs)/calls");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to join that scheduled call.");
    }
  }

  async function startPeerCall(peerUserId: string, callType: "AUDIO" | "VIDEO") {
    try {
      await calls.placeCall({ recipientUserId: peerUserId, callType });
      setError(null);
      go("/(tabs)/calls");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start that call.");
    }
  }

  function go(route: string) {
    setHubOpen(false);
    router.push(route as never);
  }

  const hubActions: Array<[string, string, string, () => void]> = [
    ["New chat", "chatbubble-ellipses-outline", C.teal, openCompose],
    ["New group", "people-outline", C.blue, () => go("/modules/contacts")],
    ["Schedule", "calendar-outline", C.purple, () => go("/(tabs)/calls")],
    ["Start call", "call-outline", C.teal, () => go("/(tabs)/calls")],
    ["Broadcast", "megaphone-outline", C.red, () => go("/modules/status")],
    ["Scan QR", "qr-code-outline", C.blue, () => go("/modules/linked-devices")]
  ];

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={s.screen}>
      <View style={s.header}>
        <HeaderButton label="Open Linqa menu" icon="menu-outline" onPress={() => go("/(tabs)/linqa")} />
        <Text style={s.brand}>Linqa</Text>
        <View style={s.headerSpacer} />
        <HeaderButton
          label={scheduledCall ? "Calendar, 1 call scheduled" : "Calendar"}
          icon="calendar-outline"
          onPress={() => go("/modules/calendar")}
          dot={Boolean(scheduledCall)}
        />
        <HeaderButton label="Calls" icon="call-outline" onPress={() => go("/(tabs)/calls")} />
        <HeaderButton label="Search" icon="search-outline" onPress={() => go("/search")} />
        <HeaderButton
          label={hubOpen ? "Close create menu" : "Create"}
          icon={hubOpen ? "close-outline" : "add-outline"}
          primary
          onPress={() => setHubOpen((open) => !open)}
        />
      </View>

      {hubOpen ? (
        <>
          {/* Tapping anywhere else dismisses, which is what makes the popover
              escapable without a visible close target. */}
          <Pressable
            style={s.hubScrim}
            accessibilityLabel="Close create menu"
            onPress={() => setHubOpen(false)}
          />
          <View style={s.actionHub}>
            {hubActions.map(([label, icon, color, onPress]) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={onPress}
                style={({ pressed }) => [s.hubItem, pressed && s.pressed]}
              >
                <Ionicons name={icon as never} size={25} color={color} />
                <Text style={s.hubLabel}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.conversationId}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(undefined, true);
            }}
            tintColor={C.teal}
            colors={[C.teal]}
          />
        }
        ListHeaderComponent={
          <View>
            <SummaryCard
              unreadTotal={data?.unreadTotal ?? 0}
              scheduledCall={scheduledCall}
              onJoin={() => void joinScheduledCall()}
            />
            <PresenceStrip
              contacts={data?.presence ?? []}
              onStatus={() => go("/modules/status")}
              onContact={() => go("/modules/contacts")}
            />
            <View style={s.filters}>
              {CHAT_FILTERS.map((key) => (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: filter === key }}
                  accessibilityLabel={`${FILTER_LABELS[key]}, ${counts[key]}`}
                  onPress={() => setFilter(key)}
                  style={[s.filter, filter === key && s.filterActive]}
                >
                  <Text style={[s.filterText, filter === key && s.filterTextActive]}>
                    {FILTER_LABELS[key]}
                  </Text>
                  <View style={[s.filterCount, filter === key && s.filterCountActive]}>
                    <Text style={[s.filterCountText, filter === key && s.filterCountTextActive]}>
                      {counts[key]}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
            {error ? (
              <Pressable style={s.errorCard} onPress={() => void load()}>
                <Ionicons name="warning-outline" size={17} color={C.red} />
                <Text style={s.errorText}>{error} Tap to retry.</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <ConversationRow
            item={
              typingIn.has(item.conversationId)
                ? { ...item, typingLabel: item.isGroup ? "Someone is typing…" : "typing…" }
                : item
            }
            onOpen={() => void openConversation(item)}
            onCall={(peerUserId, callType) => void startPeerCall(peerUserId, callType)}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={s.loader} color={C.teal} />
          ) : (
            <View style={s.empty}>
              <Ionicons name="chatbubbles-outline" size={26} color={C.muted} />
              <Text style={s.emptyText}>
                {filter === "all"
                  ? "No conversations yet."
                  : `Nothing in ${FILTER_LABELS[filter].toLowerCase()}.`}
              </Text>
            </View>
          )
        }
      />

      <Modal
        visible={composeOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setComposeOpen(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>New chat</Text>
            <ScrollView style={s.modalScroll}>
              {contacts.map((contact) => (
                <Pressable
                  key={contact.id}
                  style={s.contactRow}
                  onPress={() => void startConversation(contact)}
                >
                  <Avatar
                    seed={contact.id}
                    initials={contact.displayName.slice(0, 2).toUpperCase()}
                    size={38}
                  />
                  <Text style={s.contactName}>{contact.displayName}</Text>
                  <Ionicons name="chevron-forward" size={16} color={C.muted} />
                </Pressable>
              ))}
              {contacts.length === 0 ? (
                <Text style={s.modalHint}>No contacts are available to message yet.</Text>
              ) : null}
            </ScrollView>
            <Pressable onPress={() => setComposeOpen(false)} style={s.modalCancel}>
              <Text style={s.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SummaryCard({
  unreadTotal,
  scheduledCall,
  onJoin
}: {
  unreadTotal: number;
  scheduledCall: ChatInboxPayload["scheduledCall"];
  onJoin: () => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <View style={s.summary}>
      <View style={s.summaryTop}>
        <Avatar seed="me" initials="YO" size={62} online />
        <View style={s.summaryBody}>
          <Text style={s.greeting}>{greeting}</Text>
          <Text style={s.welcome}>Welcome back</Text>
          <Text style={s.summaryMeta}>
            {unreadTotal} unread
            {scheduledCall ? " · 1 call scheduled" : " · no calls scheduled"}
          </Text>
        </View>
      </View>

      {scheduledCall ? (
        <View style={s.scheduleCard}>
          <View style={s.scheduleIcon}>
            <Ionicons name="calendar-outline" size={17} color={C.purple} />
          </View>
          <View style={s.scheduleBody}>
            <Text style={s.scheduleTitle} numberOfLines={1}>
              {scheduledCallLabel(scheduledCall)}
            </Text>
            <Text style={s.scheduleWhen}>{scheduledCallWhen(scheduledCall)}</Text>
          </View>
          {/* Disabled outside the server's window: `joinable` is not a
              client-side time comparison. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Join scheduled call"
            accessibilityState={{ disabled: !scheduledCall.joinable }}
            disabled={!scheduledCall.joinable}
            onPress={onJoin}
            style={[s.joinButton, !scheduledCall.joinable && s.joinButtonDisabled]}
          >
            <Text style={[s.joinText, !scheduledCall.joinable && s.joinTextDisabled]}>Join</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function PresenceStrip({
  contacts,
  onStatus,
  onContact
}: {
  contacts: PresenceContact[];
  onStatus: () => void;
  onContact: (userId: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.presenceContent}
    >
      <Pressable onPress={onStatus} style={s.presenceItem} accessibilityLabel="Add my status">
        <View style={s.statusCircle}>
          <Ionicons name="add" size={26} color={C.teal} />
        </View>
        <Text style={s.presenceName}>My status</Text>
      </Pressable>
      {contacts.map((contact) => (
        <Pressable
          key={contact.userId}
          onPress={() => onContact(contact.userId)}
          style={s.presenceItem}
          accessibilityLabel={`${contact.displayName}${contact.online ? ", online" : ""}`}
        >
          <Avatar
            seed={contact.userId}
            initials={contact.initials}
            size={58}
            online={contact.online}
            ring={contact.online ? C.teal : C.border}
          />
          <Text numberOfLines={1} style={s.presenceName}>
            {contact.displayName.split(" ")[0]}
          </Text>
        </Pressable>
      ))}
      {contacts.length === 0 ? (
        <View style={s.presenceEmpty}>
          <Text style={s.presenceEmptyText}>People you message appear here.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function ConversationRow({
  item,
  onOpen,
  onCall
}: {
  item: ChatSummary;
  onOpen: () => void;
  onCall: (peerUserId: string, callType: "AUDIO" | "VIDEO") => void;
}) {
  const previewIcon =
    item.previewKind === "voice" ? "mic-outline" : item.missedCall ? "call-outline" : null;
  const unreadLabel =
    item.unreadCount > 0
      ? `, ${item.unreadCount} unread message${item.unreadCount === 1 ? "" : "s"}`
      : "";

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${unreadLabel}`}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      {item.isGroup && item.participantInitials.length > 1 ? (
        <GroupAvatar seed={item.conversationId} members={item.participantInitials} />
      ) : (
        <Avatar seed={item.conversationId} initials={item.initials} online={item.online} />
      )}

      <View style={s.rowBody}>
        <View style={s.rowTitleLine}>
          <Text numberOfLines={1} style={s.rowTitle}>
            {item.title}
          </Text>
          {item.pinned ? <Ionicons name="pin" size={14} color={C.blue} /> : null}
          {item.scheduledEvent ? <Ionicons name="calendar" size={14} color={C.purple} /> : null}
          {item.muted ? <Ionicons name="notifications-off-outline" size={14} color={C.muted} /> : null}
          {item.missedCall ? <Ionicons name="call" size={14} color={C.red} /> : null}
          <Text style={s.rowTime}>{chatTimeLabel(item.updatedAt)}</Text>
        </View>

        <View style={s.previewLine}>
          {previewIcon ? (
            <Ionicons
              name={previewIcon as never}
              size={13}
              color={item.missedCall ? C.red : C.muted}
            />
          ) : null}
          <Text numberOfLines={1} style={[s.preview, item.typingLabel ? s.typing : null]}>
            {item.typingLabel ?? item.preview ?? "No messages yet"}
          </Text>
          {item.previewKind === "voice" && item.previewDurationSeconds ? (
            <Text style={s.voiceDuration}>
              {Math.floor(item.previewDurationSeconds / 60)}:
              {String(item.previewDurationSeconds % 60).padStart(2, "0")}
            </Text>
          ) : null}
        </View>

        {/* Only rendered when there is something to say -- an always-present
            empty line would pad every row by a text height for nothing. */}
        {item.e2eeVerified || item.deliveryState === "read" ? (
          <View style={s.metaLine}>
            {/* Shown only on a server-verified ratchet, never as decoration. */}
            {item.e2eeVerified ? (
              <>
                <Ionicons name="lock-closed" size={11} color={C.muted} />
                <Text style={s.metaText}>End-to-end encrypted</Text>
              </>
            ) : null}
            {item.deliveryState === "read" ? (
              <Ionicons name="checkmark-done" size={14} color={C.cyan} />
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={s.rowTail}>
        {item.unreadCount > 0 ? (
          <View style={s.unread}>
            <Text style={s.unreadText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
          </View>
        ) : null}
        {/* Direct conversations only: a group call needs a roster this screen
            does not hold. */}
        {item.peerUserId ? (
          <View style={s.rowActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Audio call ${item.title}`}
              hitSlop={6}
              onPress={() => onCall(item.peerUserId!, "AUDIO")}
              style={({ pressed }) => [s.rowAction, pressed && s.pressed]}
            >
              <Ionicons name="call-outline" size={15} color={C.teal} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Video call ${item.title}`}
              hitSlop={6}
              onPress={() => onCall(item.peerUserId!, "VIDEO")}
              style={({ pressed }) => [s.rowAction, pressed && s.pressed]}
            >
              <Ionicons name="videocam-outline" size={15} color={C.cyan} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pressed: { opacity: 0.72 },

  header: {
    minHeight: 62,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7
  },
  brand: { color: C.white, fontFamily: fonts.extrabold, fontSize: 25, marginLeft: 8 },
  headerSpacer: { flex: 1 },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center"
  },
  headerButtonPrimary: { backgroundColor: C.teal, borderColor: C.teal },
  headerDot: {
    position: "absolute",
    right: -2,
    top: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.teal,
    borderWidth: 2,
    borderColor: C.bg
  },

  hubScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 15 },
  actionHub: {
    position: "absolute",
    zIndex: 20,
    top: 62,
    right: 14,
    width: 300,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card2,
    flexDirection: "row",
    flexWrap: "wrap",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14
  },
  hubItem: { width: "33.333%", minHeight: 82, alignItems: "center", justifyContent: "center", gap: 7 },
  hubLabel: { color: C.white, fontSize: 12.5, fontFamily: fonts.semibold, textAlign: "center" },

  list: { paddingHorizontal: 14, paddingBottom: 32, gap: 9 },

  summary: {
    marginTop: 6,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card
  },
  summaryTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryBody: { flex: 1 },
  greeting: { color: C.muted, fontSize: 12.5, fontFamily: fonts.regular },
  welcome: { color: C.white, fontSize: 21, fontFamily: fonts.extrabold, marginTop: 1 },
  summaryMeta: { color: C.teal, marginTop: 3, fontSize: 12, fontFamily: fonts.semibold },
  scheduleCard: {
    marginTop: 12,
    padding: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.divider,
    backgroundColor: C.card2,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  scheduleIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: "#221A3C",
    alignItems: "center",
    justifyContent: "center"
  },
  scheduleBody: { flex: 1 },
  scheduleTitle: { color: C.white, fontSize: 13.5, fontFamily: fonts.bold },
  scheduleWhen: { color: C.muted, fontSize: 12.5, fontFamily: fonts.regular, marginTop: 2 },
  joinButton: {
    paddingHorizontal: 17,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: C.teal
  },
  joinButtonDisabled: { backgroundColor: C.divider },
  joinText: { color: C.bg, fontFamily: fonts.extrabold, fontSize: 13 },
  joinTextDisabled: { color: C.muted },

  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: C.white, fontFamily: fonts.extrabold },
  avatarRing: { borderWidth: 2, padding: 3 },
  onlineDot: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.teal,
    borderWidth: 2.5,
    borderColor: C.bg
  },
  groupAvatar: { width: 54, height: 54 },
  groupAvatarPiece: {
    position: "absolute",
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.card
  },
  groupAvatarText: { color: C.white, fontSize: 12, fontFamily: fonts.extrabold },

  presenceContent: { paddingVertical: 14, gap: 16, alignItems: "flex-start" },
  presenceItem: { width: 66, alignItems: "center", gap: 7 },
  presenceName: {
    color: C.white,
    width: 66,
    textAlign: "center",
    fontFamily: fonts.semibold,
    fontSize: 12.5
  },
  statusCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: C.teal,
    alignItems: "center",
    justifyContent: "center",
    margin: 5
  },
  presenceEmpty: { height: 68, justifyContent: "center", paddingLeft: 4 },
  presenceEmptyText: { color: C.muted, fontSize: 12, fontFamily: fonts.regular },

  filters: {
    padding: 4,
    flexDirection: "row",
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12
  },
  filter: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6
  },
  filterActive: { backgroundColor: "#0B4A48" },
  filterText: { color: C.muted, fontFamily: fonts.bold, fontSize: 12.5 },
  filterTextActive: { color: C.teal },
  filterCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: "#173D52",
    alignItems: "center",
    justifyContent: "center"
  },
  filterCountActive: { backgroundColor: C.teal },
  filterCountText: { color: C.white, fontFamily: fonts.extrabold, fontSize: 12 },
  filterCountTextActive: { color: C.bg },

  row: {
    minHeight: 88,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  rowBody: { flex: 1, gap: 3 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { flex: 1, color: C.white, fontFamily: fonts.extrabold, fontSize: 15.5 },
  rowTime: { color: C.muted, fontSize: 12.5, fontFamily: fonts.regular },
  previewLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  preview: { flex: 1, color: C.muted, fontSize: 13, fontFamily: fonts.regular },
  typing: { color: C.teal, fontFamily: fonts.bold },
  voiceDuration: { color: C.muted, fontSize: 12, fontFamily: fonts.regular },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowTail: { alignItems: "flex-end", justifyContent: "center", gap: 8 },
  rowActions: { flexDirection: "row", gap: 6 },
  rowAction: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.divider,
    backgroundColor: C.card2,
    alignItems: "center",
    justifyContent: "center"
  },
  metaText: { color: C.muted, fontSize: 12.5, fontFamily: fonts.regular },
  unread: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    backgroundColor: C.teal,
    alignItems: "center",
    justifyContent: "center"
  },
  unreadText: { color: C.bg, fontFamily: fonts.extrabold, fontSize: 12 },

  loader: { marginTop: 36 },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 44, gap: 9 },
  emptyText: { color: C.muted, fontSize: 13, fontFamily: fonts.regular },
  errorCard: {
    marginBottom: 12,
    padding: 11,
    borderRadius: 11,
    backgroundColor: "#3A1620",
    borderWidth: 1,
    borderColor: "#7A2733",
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  errorText: { flex: 1, color: "#FFC2C8", fontSize: 12, fontFamily: fonts.regular },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: C.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: C.border,
    padding: 18,
    maxHeight: "70%"
  },
  modalTitle: { color: C.white, fontSize: 17, fontFamily: fonts.extrabold, marginBottom: 14 },
  modalScroll: { flexGrow: 0 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.divider
  },
  contactName: { flex: 1, color: C.white, fontSize: 14, fontFamily: fonts.semibold },
  modalHint: { color: C.muted, fontSize: 12.5, fontFamily: fonts.regular, paddingVertical: 12 },
  modalCancel: { marginTop: 14, alignItems: "center", paddingVertical: 10 },
  modalCancelText: { color: C.muted, fontFamily: fonts.bold, fontSize: 14 }
});

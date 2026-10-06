import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { CHAT_FILTERS, ChatInboxService, deduplicateConversations, type ChatFilter, type ChatInboxPayload, type ChatSummary } from "../../services/chat-inbox.service";
import { CallsService } from "../../services/calls.service";
import { ChatRealtimeClient, TypingRegistry } from "../../services/chat-realtime.client";
import { MobileHubService, type HubContact } from "../../services/mobile-hub.service";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";
import { C, s } from "../../components/chats/styles";
import { FILTER_LABELS, Avatar, HeaderButton, SummaryCard, PresenceStrip, ConversationRow } from "../../components/chats/parts";
import { AccountSwitcherSheet } from "../../components/AccountSwitcherSheet";
import { useAccounts } from "../../account/AccountContext";
import { ACCOUNT_SWITCH_LANDING_ROUTE } from "../../account/landing";

const API = getApiBaseUrl();

export default function ChatsScreen() {
  const router = useRouter();
  const { accounts, active, activate } = useAccounts();
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
  const [switcherOpen, setSwitcherOpen] = useState(false);
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
    ["New group", "people-outline", C.blue, () => go("/connections")],
    ["Schedule", "calendar-outline", C.purple, () => go("/(tabs)/calls")],
    ["Start call", "call-outline", C.teal, () => go("/(tabs)/calls")],
    ["Broadcast", "megaphone-outline", C.red, () => go("/modules/status")],
    ["Scan QR", "qr-code-outline", C.blue, () => go("/modules/linked-devices")]
  ];

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={s.screen}>
      <View style={s.header}>
        <HeaderButton label="Open Linqa menu" icon="menu-outline" onPress={() => go("/(tabs)/linqa")} />
        <Text style={[s.brand, { flexShrink: 1, maxWidth: 120 }]} numberOfLines={1}>
          {active?.label || active?.displayName || "Linqa"}
        </Text>
        <View style={s.headerSpacer} />
        <HeaderButton label="Search" icon="search-outline" onPress={() => go("/search")} />
        <HeaderButton
          label={hubOpen ? "Close create menu" : "Create"}
          icon={hubOpen ? "close-outline" : "add-outline"}
          primary
          onPress={() => setHubOpen((open) => !open)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch account"
          onPress={() => setSwitcherOpen(true)}
          style={{ paddingLeft: 3 }}
        >
          <Avatar
            seed={active?.userId ?? "linqa"}
            initials={(active?.label || active?.displayName || "L").slice(0, 2).toUpperCase()}
            size={32}
          />
        </Pressable>
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
              onContact={() => go("/connections")}
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

      <AccountSwitcherSheet
        visible={switcherOpen}
        accounts={accounts}
        activeUserId={active?.userId}
        onClose={() => setSwitcherOpen(false)}
        onSwitch={(userId) => {
          activate(userId);
          setSwitcherOpen(false);
          router.replace(ACCOUNT_SWITCH_LANDING_ROUTE);
        }}
        onAdd={() => {
          setSwitcherOpen(false);
          router.push(accounts.length >= 3 ? "/account/max-limit" : "/account/add-another");
        }}
        onManage={() => {
          setSwitcherOpen(false);
          router.push("/account/manage");
        }}
        onSettings={() => {
          setSwitcherOpen(false);
          router.push("/account/settings");
        }}
      />
    </SafeAreaView>
  );
}

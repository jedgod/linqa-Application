import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { CHAT_FILTERS, ChatInboxService, deduplicateConversations, type ChatFilter, type ChatInboxPayload, type ChatSummary } from "../../services/chat-inbox.service";
import { callController } from "../../services/call-controller";
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
  const { active } = useAccounts();
  return <ChatsInbox key={active?.userId ?? "signed-out"} />;
}

function ChatsInbox() {
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
  const [contactsLoading, setContactsLoading] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [foundContact, setFoundContact] = useState<HubContact | null>(null);
  const [findingPhone, setFindingPhone] = useState(false);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  const lookupVersion = useRef(0);
  const [startingContact, setStartingContact] = useState<string | null>(null);
  const creatingConversation = useRef(false);
  const [typingIn, setTypingIn] = useState<Set<string>>(new Set());
  const mounted = useRef(true);
  const loadVersion = useRef(0);

  const realtime = useMemo(
    () => new ChatRealtimeClient(API, () => accessTokenProvider.getAccessToken()),
    []
  );

  const load = useCallback(
    async (signal?: AbortSignal, quiet = false) => {
      const request = ++loadVersion.current;
      if (!quiet) setError(null);
      try {
        const result = await inbox.inbox(filter, signal);
        if (!mounted.current || signal?.aborted || request !== loadVersion.current) return;
        setData({ ...result, conversations: deduplicateConversations(result.conversations) });
        setError(null);
      } catch (cause) {
        if (signal?.aborted || !mounted.current || request !== loadVersion.current) return;
        setError(cause instanceof Error ? cause.message : "Unable to load chats.");
      } finally {
        if (mounted.current && !signal?.aborted && request === loadVersion.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [inbox, filter]
  );

  useFocusEffect(useCallback(() => {
    mounted.current = true;
    // Changing filter aborts the previous request, so a slow "All" response
    // cannot land after the user has already switched to "Unread".
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => {
      mounted.current = false;
      loadVersion.current++;
      controller.abort();
    };
  }, [load]));

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
      if (event.type === "message.created" || event.type === "conversation.read" || event.type === "conversation.created") {
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
    realtime.setConversations(ids);
  }, [realtime, data?.conversations]);

  const counts = data?.counts ?? { all: 0, unread: 0, groups: 0, pinned: 0 };
  const conversations = data?.conversations ?? [];
  const scheduledCall = data?.scheduledCall ?? null;

  function openConversation(item: ChatSummary) {
    // The thread checks access when loading and marks messages read only after encryption is available.
    router.push({ pathname: "/modules/conversation", params: { conversationId: item.conversationId, name: item.title, ...(item.peerUserId ? { peerId: item.peerUserId } : {}) } });
  }

  function closeCompose() {
    lookupVersion.current++;
    setFindingPhone(false);
    setComposeOpen(false);
  }

  async function findPhone() {
    if (findingPhone || startingContact) return;
    const ticket = ++lookupVersion.current;
    setFindingPhone(true); setFoundContact(null); setLookupNotice(null);
    try {
      const contact = await hub.findChatContact(phone);
      if (!mounted.current || ticket !== lookupVersion.current) return;
      setFoundContact(contact);
      if (!contact) setLookupNotice("No available Linqa contact found. Check the full number and country code.");
    } catch (cause) {
      if (mounted.current && ticket === lookupVersion.current) setLookupNotice(cause instanceof Error ? cause.message : "Unable to search. Try again.");
    } finally { if (mounted.current && ticket === lookupVersion.current) setFindingPhone(false); }
  }

  async function openCompose() {
    lookupVersion.current++; setPhone(""); setFoundContact(null); setLookupNotice(null); setFindingPhone(false);
    setHubOpen(false);
    setComposeOpen(true);
    setContacts([]);
    setComposeError(null);
    setContactsLoading(true);
    try {
      const snapshot = await hub.loadHub();
      if (mounted.current) setContacts(snapshot.contacts);
    } catch (cause) {
      if (mounted.current) setComposeError(cause instanceof Error ? cause.message : "Unable to load contacts.");
    } finally {
      if (mounted.current) setContactsLoading(false);
    }
  }

  async function startConversation(contact: HubContact) {
    if (creatingConversation.current) return;
    creatingConversation.current = true;
    setStartingContact(contact.id);
    setComposeError(null);
    try {
      const conversation = await hub.createConversation(contact.id);
      if (!mounted.current) return;
      setComposeOpen(false);
      router.push({ pathname: "/modules/conversation", params: { conversationId: conversation.id, name: contact.displayName, peerId: contact.id } });
    } catch (cause) {
      if (mounted.current) setComposeError(cause instanceof Error ? cause.message : "Unable to start that conversation.");
    } finally {
      creatingConversation.current = false;
      if (mounted.current) setStartingContact(null);
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

  function startPeerCall(peerUserId: string, callType: "AUDIO" | "VIDEO", peerName: string) {
    setError(null);
    void callController.start({ peerUserId, peerName, callType }).then((problem) => { if (problem) setError(problem); });
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
            onCall={(peerUserId, callType, peerName) => startPeerCall(peerUserId, callType, peerName)}
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
        onRequestClose={closeCompose}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>New chat</Text>
            <ScrollView style={s.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={s.modalHint}>Find someone by their full phone number</Text>
              <TextInput accessibilityLabel="Find contact by phone number" value={phone} maxLength={40} keyboardType="phone-pad" autoCorrect={false} placeholder="+1 202 555 0123" placeholderTextColor={C.muted} editable={startingContact === null} onChangeText={value => { lookupVersion.current++; setPhone(value); setFoundContact(null); setLookupNotice(null); setFindingPhone(false); }} style={{ color: C.white, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 48 }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Find Linqa contact" disabled={!phone.trim() || findingPhone || startingContact !== null} onPress={() => void findPhone()} style={{ padding: 12, minHeight: 44, alignItems: "center", opacity: !phone.trim() || findingPhone ? 0.5 : 1 }}><Text style={{ color: C.teal }}>{findingPhone ? "Searching…" : "Find contact"}</Text></Pressable>
              {lookupNotice ? <Text accessibilityRole="alert" style={s.modalHint}>{lookupNotice}</Text> : null}
              {foundContact ? <Pressable accessibilityRole="button" accessibilityLabel={`Start chat with ${foundContact.displayName}`} disabled={startingContact !== null} onPress={() => void startConversation(foundContact)} style={s.contactRow}><Avatar seed={foundContact.id} initials={foundContact.initials} size={38} /><View style={{ flex: 1 }}><Text style={s.contactName}>{foundContact.displayName}</Text><Text style={s.modalHint}>{phone}</Text></View><Text style={{ color: C.teal }}>{startingContact === foundContact.id ? "Opening…" : "Chat"}</Text></Pressable> : null}
              <Text style={s.modalHint}>Recent contacts</Text>
              {contacts.map((contact) => (
                <Pressable
                  key={contact.id}
                  style={s.contactRow}
                  accessibilityRole="button"
                  accessibilityLabel={`Start chat with ${contact.displayName}`}
                  accessibilityState={{ disabled: startingContact !== null }}
                  disabled={startingContact !== null}
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
              {contactsLoading ? <ActivityIndicator accessibilityLabel="Loading contacts" color={C.teal} /> : null}
              {composeError ? <Text accessibilityRole="alert" style={s.modalHint}>{composeError}</Text> : null}
              {composeError && contacts.length === 0 ? <Pressable accessibilityRole="button" onPress={() => void openCompose()}><Text style={s.modalHint}>Try again</Text></Pressable> : null}
              {!contactsLoading && !composeError && contacts.length === 0 ? (
                <Text style={s.modalHint}>No contacts are available to message yet.</Text>
              ) : null}
            </ScrollView>
            <Pressable onPress={closeCompose} style={s.modalCancel}>
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

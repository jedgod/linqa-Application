import { t } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useChatPreviews } from "../../services/chat-previews";
import { startSecureCallForPeer } from "../../services/secure-call-rooms";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { CHAT_FILTERS, ChatInboxService, deduplicateConversations, type ChatFilter, type ChatInboxPayload, type ChatList, type ChatSummary } from "../../services/chat-inbox.service";
import { callController } from "../../services/call-controller";
import { CallsService } from "../../services/calls.service";
import { ChatRealtimeClient, TypingRegistry } from "../../services/chat-realtime.client";
import { MobileHubService, type HubContact } from "../../services/mobile-hub.service";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";
import { C, s } from "../../components/chats/styles";
import { FILTER_LABELS, Avatar, HeaderButton, SummaryCard, PresenceStrip, ConversationRow } from "../../components/chats/parts";
import { AccountSwitcherSheet } from "../../components/AccountSwitcherSheet";
import { PeopleSheet, type PickPerson } from "../../components/conversation/ChatActionSheets";
import { THEMES } from "../../services/conversation-engine";
import { useAccounts } from "../../account/AccountContext";
import { ACCOUNT_SWITCH_LANDING_ROUTE } from "../../account/landing";
import { SideDrawer } from "../../components/drawer/SideDrawer";
import { DrawerMenu } from "../../components/drawer/DrawerMenu";
import type { DrawerItem } from "../../components/drawer/drawerItems";
import { useProfile } from "../../hooks/useProfile";
import { avatarUri } from "../../lib/profileApi";

const API = getApiBaseUrl();

export default function ChatsScreen() {
  useTranslation();
  const { active } = useAccounts();
  return <ChatsInbox key={active?.userId ?? "signed-out"} />;
}

function ChatsInbox() {
  useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ action?: string }>();
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
  /** A custom list being viewed (its chats are shown under "All"). */
  const [listId, setListId] = useState<string | null>(null);
  const [lists, setLists] = useState<ChatList[]>([]);
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListError, setNewListError] = useState<string | null>(null);
  const [organizeNote, setOrganizeNote] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [renaming, setRenaming] = useState<ChatList | null>(null);
  const [data, setData] = useState<ChatInboxPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hubOpen, setHubOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { profile, imageHeaders } = useProfile();
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
  const loadInFlight = useRef(false);

  const realtime = useMemo(
    () => new ChatRealtimeClient(API, () => accessTokenProvider.getAccessToken()),
    []
  );

  const load = useCallback(
    async (signal?: AbortSignal, quiet = false) => {
      const request = ++loadVersion.current;
      loadInFlight.current = true;
      if (!quiet) setError(null);
      try {
        const result = await inbox.inbox(filter, signal, listId ?? undefined);
        if (!mounted.current || signal?.aborted || request !== loadVersion.current) return;
        setData({ ...result, conversations: deduplicateConversations(result.conversations) });
        setError(null);
      } catch (cause) {
        if (signal?.aborted || !mounted.current || request !== loadVersion.current) return;
        setError(cause instanceof Error ? cause.message : "Unable to load chats.");
      } finally {
        if (request === loadVersion.current) loadInFlight.current = false;
        if (mounted.current && !signal?.aborted && request === loadVersion.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [inbox, filter, listId]
  );

  const loadLists = useCallback(async () => {
    try { const next = await inbox.lists(); if (mounted.current) setLists(next); } catch { /* the chips stay as they were */ }
  }, [inbox]);
  useFocusEffect(useCallback(() => { void loadLists(); }, [loadLists]));

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

  useEffect(() => {
    if (!error) return;
    const retry = () => {
      if (mounted.current && AppState.currentState === "active" && !loadInFlight.current) void load(undefined, true);
    };
    const timer = setInterval(retry, 5000);
    const subscription = AppState.addEventListener("change", state => { if (state === "active") retry(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [error, load]);

  useFocusEffect(useCallback(() => {
    const refresh = () => { if (mounted.current && AppState.currentState === 'active' && !loadInFlight.current) void load(undefined, true); };
    const timer = setInterval(refresh, 30_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
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

  const counts = data?.counts ?? { all: 0, unread: 0, groups: 0, pinned: 0, archived: 0 };
  const conversations = useChatPreviews(active?.userId ?? "", data?.conversations ?? []);
  const scheduledCall = data?.scheduledCall ?? null;

  function openConversation(item: ChatSummary) {
    // The thread checks access when loading and marks messages read only after encryption is available.
    router.push({ pathname: "/modules/conversation", params: { conversationId: item.conversationId, name: item.title, ...(item.peerUserId ? { peerId: item.peerUserId } : {}) } });
  }

  /** Long press on a chat: favorite, archive and lists. These are the same on the person's other devices. */
  function organizeChat(item: ChatSummary) {
    const refresh = () => { void load(undefined, true); void loadLists(); };
    const run = (work: () => Promise<unknown>) => { setOrganizeNote(null); work().then(refresh, () => setOrganizeNote("That change did not save. Check your connection and try again.")); };
    const archived = Boolean(item.archived) || filter === "archived";
    const pickList = () => {
      if (lists.length === 0) { setNewListOpen(true); return; }
      Alert.alert("Lists", item.title, [
        ...lists.slice(0, 6).map((l) => ({
          text: (item.listIds?.includes(l.id) ? "✓ " : "") + l.name,
          onPress: () => run(() => inbox.setInList(l.id, item.conversationId, !item.listIds?.includes(l.id)))
        })),
        { text: "New list…", onPress: () => setNewListOpen(true) },
        { text: "Cancel", style: "cancel" as const }
      ]);
    };
    Alert.alert(item.title, undefined, [
      { text: item.pinned ? "Remove from favorites" : "Add to favorites", onPress: () => run(() => inbox.setFavorite(item.conversationId, !item.pinned)) },
      { text: archived ? "Unarchive" : "Archive", onPress: () => run(() => inbox.setArchived(item.conversationId, !archived)) },
      { text: "Add to list…", onPress: pickList },
      { text: "Cancel", style: "cancel" }
    ]);
  }

  async function createList() {
    const name = newListName.trim();
    if (!name) return;
    setNewListError(null);
    try {
      if (renaming) await inbox.renameList(renaming.id, name); else await inbox.createList(name);
      setRenaming(null);
      setNewListOpen(false); setNewListName("");
      void loadLists();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setNewListError(code === "LIST_EXISTS" ? "You already have a list with that name." : code === "TOO_MANY_LISTS" ? "You have reached the limit of 20 lists." : "The list could not be created.");
    }
  }

  /** Long press on a list chip: rename or delete it. */
  function listMenu(list: ChatList) {
    Alert.alert(list.name, undefined, [
      { text: "Rename", onPress: () => { setRenaming(list); setNewListName(list.name); setNewListOpen(true); } },
      { text: "Delete", style: "destructive", onPress: () => removeList(list) },
      { text: "Cancel", style: "cancel" }
    ]);
  }

  function removeList(list: ChatList) {
    Alert.alert(`Delete "${list.name}"?`, "Your chats stay where they are.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { void inbox.deleteList(list.id).then(() => { if (listId === list.id) setListId(null); void loadLists(); }, () => setOrganizeNote("The list could not be deleted.")); } }
    ]);
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

  // The Create sheet opens Chats with ?action=new (new chat) or ?action=group (new group).
  useEffect(() => {
    if (!params.action) return;
    if (params.action === "new") void openCompose();
    else if (params.action === "group") setGroupOpen(true);
    router.setParams({ action: "" }); // undefined would leave it set, and the same shortcut would then do nothing next time
  }, [params.action]); // eslint-disable-line react-hooks/exhaustive-deps

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
    void startSecureCallForPeer(peerUserId, callType).then((problem) => { if (problem) setError(problem); });
  }

  function go(route: string) {
    setHubOpen(false);
    router.push(route as never);
  }

  const openDrawer = useCallback(() => { setHubOpen(false); setDrawerOpen(true); }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  function selectDrawerItem(item: DrawerItem) {
    closeDrawer();
    if (item.action === "new-group") setGroupOpen(true);
    else if (item.action === "archived") { setListId(null); setFilter("archived"); }
    else if (item.href) go(item.href);
  }

  const hubActions: Array<[string, string, string, () => void]> = [
    ["New chat", "chatbubble-ellipses-outline", C.teal, openCompose],
    ["New group", "people-outline", C.blue, () => { setHubOpen(false); setGroupOpen(true); }],
    ["Schedule", "calendar-outline", C.purple, () => go("/(tabs)/calls")],
    ["Start call", "call-outline", C.teal, () => go("/(tabs)/calls")],
    ["Broadcast", "megaphone-outline", C.red, () => go("/modules/status")],
    ["Scan QR", "qr-code-outline", C.blue, () => go("/modules/linked-devices")]
  ];

  return (
    <SideDrawer
      open={drawerOpen}
      onOpen={openDrawer}
      onClose={closeDrawer}
      drawerContent={
        <DrawerMenu
          user={{
            name: active?.label || active?.displayName || "Linqa",
            username: profile?.username ?? null,
            avatarUrl: avatarUri(profile?.avatarUrl) ?? active?.avatarUri ?? null,
            avatarHeaders: imageHeaders
          }}
          onClose={closeDrawer}
          onSelect={selectDrawerItem}
          onProfilePress={() => { closeDrawer(); router.push("/account/manage" as never); }}
        />
      }
    >
    <SafeAreaView edges={["top", "left", "right"]} style={s.screen}>
      <View style={s.header}>
        <HeaderButton label="Open Linqa menu" icon="menu-outline" onPress={openDrawer} />
        <Text style={[s.brand, { flexShrink: 1, maxWidth: 120 }]} numberOfLines={1}>
          {active?.label || active?.displayName || "Linqa"}
        </Text>
        <View style={s.headerSpacer} />
        <HeaderButton label={t("Search")} icon="search-outline" onPress={() => go("/search")} />
        <HeaderButton
          label={hubOpen ? "Close create menu" : "Create"}
          icon={hubOpen ? "close-outline" : "add-outline"}
          primary
          onPress={() => setHubOpen((open) => !open)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Switch account")}
          onPress={() => setSwitcherOpen(true)}
          style={{ paddingLeft: 3 }}
        >
          <Avatar
            seed={active?.userId ?? "linqa"}
            initials={(active?.label || active?.displayName || "L").slice(0, 2).toUpperCase()}
            size={32}
            photoUri={avatarUri(profile?.avatarUrl)}
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
              unreadTotal={data?.unreadTotal ?? null}
              scheduledCall={scheduledCall}
              scheduledCallCount={data ? (data.scheduledCallCount ?? (scheduledCall ? 1 : 0)) : null}
              status={error ? (data ? 'stale' : 'error') : data ? 'ready' : 'loading'}
              photoUri={avatarUri(profile?.avatarUrl)}
              photoHeaders={imageHeaders}
              onJoin={() => void joinScheduledCall()}
            />
            <PresenceStrip
              contacts={data?.presence ?? []}
              onStatus={() => go("/modules/status")}
              onContact={() => go("/connections")}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filters} contentContainerStyle={{ gap: 4 }}>
              {CHAT_FILTERS.map((key) => (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: filter === key }}
                  accessibilityLabel={`${t(FILTER_LABELS[key])}, ${counts[key]}`}
                  onPress={() => { setListId(null); setFilter(key); }}
                  style={[s.filter, filter === key && !listId && s.filterActive]}
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
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6, paddingHorizontal: 2 }}>
              {lists.map((list) => (
                <Pressable
                  key={list.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: listId === list.id }}
                  accessibilityLabel={`List ${list.name}, ${list.count}`}
                  accessibilityHint="Long press to rename or delete this list"
                  onPress={() => { setFilter("all"); setListId(listId === list.id ? null : list.id); }}
                  onLongPress={() => listMenu(list)}
                  style={[s.filter, listId === list.id && s.filterActive]}
                >
                  <Ionicons name="folder-outline" size={14} color={listId === list.id ? C.white : C.muted} />
                  <Text style={[s.filterText, listId === list.id && s.filterTextActive]}>{list.name}</Text>
                  <View style={[s.filterCount, listId === list.id && s.filterCountActive]}><Text style={[s.filterCountText, listId === list.id && s.filterCountTextActive]}>{list.count}</Text></View>
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" accessibilityLabel={t("Create a list")} onPress={() => setNewListOpen(true)} style={s.filter}>
                <Ionicons name="add" size={16} color={C.teal} />
                <Text style={[s.filterText, { color: C.teal }]}>{t("New list")}</Text>
              </Pressable>
            </ScrollView>
            {organizeNote ? <Text accessibilityRole="alert" style={s.modalHint}>{organizeNote}</Text> : null}
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
            onLongPress={() => organizeChat(item)}
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
            <Text style={s.modalTitle}>{t("New chat")}</Text>
            <ScrollView style={s.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={s.modalHint}>Find someone by their full phone number</Text>
              <TextInput accessibilityLabel="Find contact by phone number" value={phone} maxLength={40} keyboardType="phone-pad" autoCorrect={false} placeholder="+1 202 555 0123" placeholderTextColor={C.muted} editable={startingContact === null} onChangeText={value => { lookupVersion.current++; setPhone(value); setFoundContact(null); setLookupNotice(null); setFindingPhone(false); }} style={{ color: C.white, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 48 }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Find Linqa contact" disabled={!phone.trim() || findingPhone || startingContact !== null} onPress={() => void findPhone()} style={{ padding: 12, minHeight: 44, alignItems: "center", opacity: !phone.trim() || findingPhone ? 0.5 : 1 }}><Text style={{ color: C.teal }}>{findingPhone ? "Searching…" : "Find contact"}</Text></Pressable>
              {lookupNotice ? <Text accessibilityRole="alert" style={s.modalHint}>{lookupNotice}</Text> : null}
              {foundContact ? <Pressable accessibilityRole="button" accessibilityLabel={`Start chat with ${foundContact.displayName}`} disabled={startingContact !== null} onPress={() => void startConversation(foundContact)} style={s.contactRow}><Avatar seed={foundContact.id} initials={foundContact.initials} size={38} /><View style={{ flex: 1 }}><Text style={s.contactName}>{foundContact.displayName}</Text><Text style={s.modalHint}>{phone}</Text></View><Text style={{ color: C.teal }}>{startingContact === foundContact.id ? "Opening…" : "Chat"}</Text></Pressable> : null}
              <Text style={s.modalHint}>{t("Recent contacts")}</Text>
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
              {composeError && contacts.length === 0 ? <Pressable accessibilityRole="button" onPress={() => void openCompose()}><Text style={s.modalHint}>{t("Try again")}</Text></Pressable> : null}
              {!contactsLoading && !composeError && contacts.length === 0 ? (
                <Text style={s.modalHint}>No contacts are available to message yet.</Text>
              ) : null}
            </ScrollView>
            <Pressable onPress={closeCompose} style={s.modalCancel}>
              <Text style={s.modalCancelText}>{t("Cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={newListOpen} transparent animationType="fade" onRequestClose={() => setNewListOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>{renaming ? "Rename list" : "New list"}</Text>
            <Text style={s.modalHint}>A list sorts your chats. Only you see it, and it is the same on your computer.</Text>
            <TextInput accessibilityLabel="List name" value={newListName} maxLength={40} autoFocus placeholder="Work, Family, …" placeholderTextColor={C.muted} onChangeText={(v) => { setNewListName(v); setNewListError(null); }} onSubmitEditing={() => void createList()} style={{ color: C.white, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 48 }} />
            {newListError ? <Text accessibilityRole="alert" style={s.modalHint}>{newListError}</Text> : null}
            <Pressable accessibilityRole="button" disabled={!newListName.trim()} onPress={() => void createList()} style={{ padding: 12, minHeight: 44, alignItems: "center", opacity: newListName.trim() ? 1 : 0.5 }}><Text style={{ color: C.teal }}>{renaming ? "Save" : "Create list"}</Text></Pressable>
            <Pressable onPress={() => { setNewListOpen(false); setNewListName(""); setNewListError(null); setRenaming(null); }} style={s.modalCancel}><Text style={s.modalCancelText}>{t("Cancel")}</Text></Pressable>
          </View>
        </View>
      </Modal>

      <PeopleSheet
        visible={groupOpen} theme={THEMES.dark} title={t("New group")} confirm={t("Create group")} maxPick={4} askName
        people={((data?.conversations ?? []).filter((c) => !c.isGroup && c.peerUserId).map((c): PickPerson => ({ userId: c.peerUserId!, name: c.title })))}
        onClose={() => setGroupOpen(false)}
        onConfirm={async (userIds, name) => {
          const id = await inbox.createGroup(name, userIds);
          setGroupOpen(false);
          void load(undefined, true);
          router.push({ pathname: "/modules/conversation", params: { conversationId: id, name } });
        }}
      />

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
    </SideDrawer>
  );
}

import { startSecureCall } from "../../services/secure-call-rooms";
//conversation.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Text, View, useColorScheme } from "react-native";
import { ExpoSqliteMobileOutboxDb } from "../../src/messaging/sqlite-outbox";
import { sealedTextOutbox, type SealedTextOutbox } from "../../services/sealed-text-outbox";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAccounts } from "../../account/AccountContext";
import { ConversationScreen } from "../../components/conversation/ConversationScreen";
import { ForwardSheet, PeopleSheet, ReportChatSheet, type ForwardTarget, type PickPerson } from "../../components/conversation/ChatActionSheets";
import { resolveTheme } from "../../services/conversation-engine";
import type { ChatControls } from "../../services/chat-inbox.service";
import { useCountryClient } from "../../components/CountryLinqaUI";
import { getApiBaseUrl } from "../../config/api";
import { sendGroup, sendPeer, sharedSecureSession } from "../../services/shared-secure-session";
import { ChatInboxService } from "../../services/chat-inbox.service";
import { CallsService } from "../../services/calls.service";
import { callController } from "../../services/call-controller";
import { handOffToAssistant } from "../../services/assistant.service";
import { createMessagingGate } from "../../services/conversation-gate";
import { DEFAULT_PREFS, type ConversationPrefs } from "../../services/conversation-engine";
import { loadPrefs, savePrefs } from "../../services/conversation-prefs";
import { ConversationService } from "../../services/conversation.service";
import type { ConversationPeer } from "../../services/conversation-types";
import { RuntimeCapabilitiesService } from "../../services/runtime-capabilities.service";
import { accessTokenProvider } from "../../services/session";

const API = getApiBaseUrl();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Conversation page (opened from Chats), with Decisions, Verify and Settings. It is built to fail closed: until this
 * device has a native secure core and the server reports secure messaging ready, messages stay sealed and nothing can be sent.
 */
function RealConversation() {
  const router = useRouter();
  const { conversationId, name, peerId, aiShare } = useLocalSearchParams<{ conversationId?: string; name?: string; peerId?: string; aiShare?: string }>();
  const { active } = useAccounts();
  const selfId = active?.userId ?? "";
  const countryClient = useCountryClient();

  // The secure core: the native bridge (when this build has it) over this account's own device keys. Without the bridge there is no
  // core, the gate locks, and nothing can be sent or opened.
  // One secure session per account, shared with the chat list's previews, so a message opened for a preview still opens here.
  const peerRef = sendPeer;
  const secure = useMemo(() => sharedSecureSession(selfId), [selfId]);
  const gate = useMemo(() => createMessagingGate({ core: secure?.device.asNativeCore() ?? null, capabilities: () => new RuntimeCapabilitiesService(API).snapshot() }), [secure]);
  // Other people can only message this phone once its key package is published.
  useEffect(() => { if (secure) void secure.server.publishKeyPackage(secure.device, secure.store).catch(() => undefined); }, [secure]);
  // Sealed messages wait here until the relay accepts them, so a retry or an app restart resends the same bytes.
  const [outbox, setOutbox] = useState<SealedTextOutbox | null>(null);
  const [rejectionNotice, setRejectionNotice] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setOutbox(null);
    if (!selfId || !secure) return;
    ExpoSqliteMobileOutboxDb.open(selfId).then((db) => { if (live) setOutbox(sealedTextOutbox(db, selfId)); }, () => undefined);
    return () => { live = false; };
  }, [selfId, secure]);
  const service = useMemo(() => new ConversationService(API, () => accessTokenProvider.getAccessToken(), selfId, secure?.messaging, undefined, undefined, outbox), [selfId, secure, outbox]);
  // Resend anything left over at startup and whenever the app returns to the foreground.
  useEffect(() => {
    if (!outbox) return;
    let active = true;
    // The flush covers every conversation of the account, so the notice is generic; the thread's own panel lists its refusals.
    const flush = () => { void service.flushOutbox(() => { if (active) setRejectionNotice("An outgoing message was not sent. Review your chats."); }).catch(() => undefined); };
    flush();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") flush(); });
    return () => { active = false; sub.remove(); };
  }, [outbox, service]);
  const inbox = useMemo(() => new ChatInboxService(API, () => accessTokenProvider.getAccessToken()), []);
  const calls = useMemo(() => new CallsService(API, () => accessTokenProvider.getAccessToken()), []);
  const placingCall = useRef(false);
  const newId = useCallback(() => Crypto.randomUUID(), []);

  const [peer, setPeer] = useState<ConversationPeer>({ id: UUID.test(peerId ?? "") ? peerId! : null, displayName: name?.slice(0, 60) || "Conversation" });
  const [prefs, setPrefs] = useState<ConversationPrefs>(DEFAULT_PREFS);
  const [blocked, setBlocked] = useState<{ at: string | null } | null>(null);
  const [pinned, setPinned] = useState(false);
  const [disappear, setDisappear] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [controls, setControls] = useState<ChatControls | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [contacts, setContacts] = useState<PickPerson[]>([]);
  const systemScheme = useColorScheme();
  const [forwardText, setForwardText] = useState<string | null>(null);
  const [otherChats, setOtherChats] = useState<Array<ForwardTarget & { peerUserId: string | null; memberUserIds?: string[] }>>([]);
  peerRef.current = peer.id;

  useEffect(() => { let live = true; if (conversationId) void loadPrefs(conversationId).then((p) => { if (live) setPrefs(p); }); return () => { live = false; }; }, [conversationId]);

  // Who it is with, and whether it is muted: the server knows both. A brand-new chat may not be listed yet.
  useEffect(() => {
    let live = true;
    if (!conversationId) return;
    sendGroup.current = null;
    inbox.inbox("all").then((payload) => {
      const row = payload.conversations.find((x) => x.conversationId === conversationId);
      if (!live || !row) return;
      setPeer({ id: row.peerUserId, displayName: row.title });
      sendGroup.current = row.isGroup && row.memberUserIds ? row.memberUserIds.filter((id) => id !== selfId) : null;
      setPrefs((p) => ({ ...p, quiet: row.muted }));
    }, () => undefined);
    return () => { live = false; };
  }, [conversationId, inbox]);

  // The server is the source of truth for mute, pin and disappearing messages.
  useEffect(() => {
    let live = true;
    if (!conversationId || !selfId) return;
    service.settings(conversationId).then((r) => {
      if (!live) return;
      setPinned(r.pinned); setDisappear(r.disappearAfterSeconds);
      setPrefs((p) => ({ ...p, quiet: r.muted }));
    }, () => undefined);
    return () => { live = false; };
  }, [conversationId, selfId, service]);

  // Is this person blocked? (The Blocked Accounts list is the source of truth.)
  const refreshBlocked = useCallback(async (peerId: string | null) => {
    if (!peerId) { setBlocked(null); return; }
    try {
      const { items } = await countryClient.blockedAccounts();
      const hit = items.find((b) => b.userId === peerId);
      setBlocked(hit ? { at: hit.blockedAt ?? null } : null);
    } catch { /* leave as it was */ }
  }, [countryClient]);
  useEffect(() => { void refreshBlocked(peer.id); }, [peer.id, refreshBlocked]);

  // The group's people (and who it is with) come from the server. Contacts to add are the people already chatted with directly.
  const loadControls = useCallback(async () => {
    if (!conversationId) return;
    const value=await inbox.controls(conversationId);
    setControls(value);
  }, [conversationId, inbox]);
  useEffect(() => { void loadControls().catch(()=>undefined); }, [loadControls]);
  useEffect(() => {
    inbox.inbox("all").then((payload) => setOtherChats(payload.conversations.filter((c) => c.conversationId !== conversationId).map((c) => ({ conversationId: c.conversationId, title: c.title, peerUserId: c.peerUserId, ...(c.memberUserIds ? { memberUserIds: c.memberUserIds } : {}) }))), () => undefined);
  }, [inbox, conversationId]);
  useEffect(() => {
    inbox.inbox("all").then((payload) => setContacts(payload.conversations.filter((c) => !c.isGroup && c.peerUserId).map((c) => ({ userId: c.peerUserId!, name: c.title }))), () => undefined);
  }, [inbox]);

  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/chats")), [router]);

  function changePrefs(next: ConversationPrefs) {
    const before = prefs;
    setPrefs(next);
    if (!conversationId) return;
    void savePrefs(conversationId, next).then((ok) => { if (!ok) setNotice("Couldn't save that preference on this device."); });
    // Muting is a real setting: the server stops sending alerts for this conversation.
    if (next.quiet !== before.quiet) {
      setNotice(null);
      service.setMuted(conversationId, next.quiet).catch(() => {
        setPrefs((p) => ({ ...p, quiet: before.quiet }));
        setNotice("Couldn't change mute. Check your connection and try again.");
      });
    }
  }
  function changePinned(next: boolean) {
    if (!conversationId) return;
    const before = pinned;
    setPinned(next); setNotice(null);
    service.setPinned(conversationId, next).catch(() => { setPinned(before); setNotice("Couldn't change pin. Check your connection and try again."); });
  }
  function changeDisappear(next: number | null) {
    if (!conversationId) return;
    const before = disappear;
    setDisappear(next); setNotice(null);
    service.setDisappearing(conversationId, next).catch(() => { setDisappear(before); setNotice("Couldn't change disappearing messages. Check your connection and try again."); });
  }
  function block() {
    if (!peer.id) { setNotice("Couldn't tell who this conversation is with. Open it from your chats list."); return; }
    setNotice(null);
    countryClient.blockUser(peer.id).then(() => refreshBlocked(peer.id), () => setNotice("Couldn't block this person. Try again."));
  }
  function unblock() {
    if (!peer.id) return;
    setNotice(null);
    countryClient.unblockAccount(peer.id).then(() => setBlocked(null), () => setNotice("Couldn't unblock this person. Try again."));
  }

  /** Forward a message's text: it is sealed again for each chosen chat, with the people in that chat. */
  async function forwardTo(conversationIds: string[]) {
    const text = forwardText;
    if (!text) return;
    const keepPeer = sendPeer.current;
    const keepGroup = sendGroup.current;
    let failed = 0;
    try {
      for (const id of conversationIds) {
        const target = otherChats.find((c) => c.conversationId === id);
        if (!target) { failed += 1; continue; }
        // Sealing uses whoever the current chat is with, so point it at the target chat for this message.
        sendGroup.current = target.memberUserIds ? target.memberUserIds.filter((m) => m !== selfId) : null;
        sendPeer.current = target.peerUserId;
        try { await service.send(id, { type: "text", text, lane: "General", forwarded: true }, newId()); } catch { failed += 1; }
      }
    } finally { sendPeer.current = keepPeer; sendGroup.current = keepGroup; }
    if (failed > 0) throw new Error("FORWARD_FAILED");
    setNotice(null);
  }

  function confirmClear() {
    if (!conversationId) return;
    Alert.alert("Clear this chat?", "Messages in this chat will be removed from your devices. The other people keep their copy, and new messages will still arrive.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear chat", style: "destructive", onPress: () => { void inbox.clearChat(conversationId).then(() => { setNotice(null); back(); }, () => setNotice("Couldn't clear the chat. Check your connection and try again.")); } }
    ]);
  }
  function confirmDelete() {
    if (!conversationId) return;
    Alert.alert("Delete this chat?", "The chat and its messages are removed from your devices and your lists. The other people keep their copy. A new message from them will bring the chat back.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete chat", style: "destructive", onPress: () => { void inbox.deleteChat(conversationId).then(() => router.replace("/(tabs)/chats"), () => setNotice("Couldn't delete the chat. Check your connection and try again.")); } }
    ]);
  }

  function call(kind: "AUDIO" | "VIDEO") {
    if (!peer.id || blocked || placingCall.current) return;
    const recipientUserId = peer.id;
    Alert.alert(`${kind === "AUDIO" ? "Audio" : "Video"} call`, `Call ${peer.displayName}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Call", onPress: () => {
        if (placingCall.current) return;
        placingCall.current = true;
        setNotice(null);
        void startSecureCall(conversationId!, kind, [recipientUserId]).then((problem) => { if (problem) setNotice(problem); }).finally(() => { placingCall.current = false; });
      } }
    ]);
  }

  if (!conversationId || !selfId) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}><Text>This conversation isn't available.</Text></View>;
  }
  const sheetTheme = resolveTheme(prefs.theme, systemScheme);
  const existingMembers = new Set(controls?.members.map((m) => m.userId) ?? []);
  return (
    <>
    <ForwardSheet visible={forwardText !== null} theme={sheetTheme} targets={otherChats} onClose={() => setForwardText(null)} onConfirm={forwardTo} />
    <ReportChatSheet visible={reportOpen} theme={sheetTheme} title={`Report ${controls?.title ?? peer.displayName}`} onClose={() => setReportOpen(false)} onSend={(category, description) => inbox.reportChat(conversationId, category, description)} />
    <PeopleSheet
      visible={addPeopleOpen} theme={sheetTheme} title={`Add people to ${controls?.title ?? peer.displayName}`} confirm="Add people" maxPick={Math.max(0,5-existingMembers.size)}
      people={contacts.filter((c) => !existingMembers.has(c.userId))}
      onClose={() => setAddPeopleOpen(false)}
      onConfirm={async (userIds) => { await inbox.addGroupMembers(conversationId, userIds); await loadControls(); }}
    />
    <ConversationScreen
      conversationId={conversationId}
      selfId={selfId}
      peer={peer}
      service={service}
      gate={gate}
      newId={newId}
      prefs={prefs}
      onPrefsChange={changePrefs}
      blocked={blocked}
      onBlock={block}
      onUnblock={unblock}
      pinned={pinned}
      disappearAfterSeconds={disappear}
      onPinnedChange={changePinned}
      onDisappearChange={changeDisappear}
      safetyNumber={null}
      onBack={back}
      notice={notice ?? rejectionNotice}
      rejectedOutbox={outbox?.failures}
      onCall={call}
      onForward={(text) => setForwardText(text)}
      chatActions={{
        isGroup: controls?.isGroup ?? false,
        members: (controls?.members ?? []).map((m) => ({ name: m.displayName, role: m.role })),
        onReport: () => setReportOpen(true),
        onClear: confirmClear,
        onDelete: confirmDelete,
        ...(controls?.isGroup && controls.members.some((m) => m.userId === selfId && m.role !== "MEMBER") ? { onAddPeople: () => setAddPeopleOpen(true) } : {})
      }}
      aiShareOnOpen={aiShare === "1"}
      onAskAi={(context) => { handOffToAssistant(context); if (aiShare === "1") router.back(); else router.push("/modules/ai"); }}
      onAiShareCancelled={() => { if (aiShare === "1") router.back(); }}
    />
    </>
  );
}

/**
 * Chats always opens the authenticated conversation. The sample design is available only through the separate
 * development-only conversation-preview route.
 */
export default function ConversationRoute() {
  const { conversationId } = useLocalSearchParams<{ conversationId?: string }>();
  const { active } = useAccounts();
  return <RealConversation key={`${active?.userId ?? ""}:${conversationId ?? ""}`} />;
}

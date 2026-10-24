//ConversationScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { disappearLabel, resolveTheme, type ConversationPrefs, type Lane, type MediaPayload, type Payload, type ReplyRef, THEMES, chatTheme } from "../../services/conversation-engine";
import { buildDecisions, buildTimeline, type TimelineItem } from "../../services/conversation-state";
import type { ConversationPeer, ConversationServiceLike, MessagingGateLike } from "../../services/conversation-types";
import * as Clipboard from "expo-clipboard";
import { CapturePanel, type CaptureKind } from "./CapturePanel";
import type { ComposerAction } from "./ComposerMenu";
import { AddSheet } from "./AddSheet";
import { CardFormView } from "./CardFormView";
import { SharedAttachmentForm } from "./SharedAttachmentForm";
import type { ThreadAction } from "../../services/conversation-thread";
import { ComposerArea } from "./ComposerArea";
import { ConversationHeader } from "./ConversationHeader";
import { DecisionsView } from "./DecisionsView";
import { MessageDeleteButton } from "./MessageDeleteButton";
import { MessageBubble } from "./MessageBubble";
import { ReplyBar, SwipeToReply, replyPreview } from "./ReplyUi";
import { SafetyNumberView } from "./SafetyNumberView";
import { RejectedMessagesPanel } from "./RejectedMessagesPanel";
import type { RejectedOutbox } from "../../services/rejected-outbox";
import { discardLocalMedia } from "../../services/conversation-media";
import { SettingsView } from "./SettingsView";
import { radius, space, type } from "./theme";
import { useConversation } from "./useConversation";
import { useProductionFeatures } from "./useProductionFeatures";
import { WallpaperBackground } from "./WallpaperBackground";
import { WallpaperPicker } from "./WallpaperPicker";
import type { WallpaperState } from "./useWallpaper";
import { wallpaperTheme } from "../../services/wallpapers";

export interface ConversationScreenProps {
  conversationId: string;
  selfId: string;
  peer: ConversationPeer;
  service: ConversationServiceLike;
  gate: MessagingGateLike;
  newId: () => string;
  prefs: ConversationPrefs;
  onPrefsChange: (next: ConversationPrefs) => void;
  /** Set while the person is blocked (with when, if known). The conversation stays visible, with Unblock at the bottom. */
  blocked: { at: string | null } | null;
  onBlock: () => void;
  onUnblock: () => void;
  /** The twelve five-digit groups of the safety number, or null when the secure core cannot derive it. */
  safetyNumber: string[] | null;
  onBack: () => void;
  pinned: boolean;
  disappearAfterSeconds: number | null;
  onPinnedChange: (pinned: boolean) => void;
  onDisappearChange: (seconds: number | null) => void;
  /** Shown above the list (for example "couldn't save that preference"). */
  notice?: string | null;
  /** Hands the readable text of this chat to Linqa AI, after the person confirms. */
  onAskAi?: (context: { label: string; lines: string[] }) => void;
  /** Opened from Linqa AI's "share a chat": ask for confirmation as soon as the messages are loaded. */
  aiShareOnOpen?: boolean;
  onAiShareCancelled?: () => void;
  /** The chat wallpaper (this chat's own, else the person's default). Absent where wallpapers are not wired up. */
  wallpaper?: WallpaperState;
  /** Messages the relay refused for good, kept on this device so they can be seen and discarded. */
  rejectedOutbox?: RejectedOutbox;
  onCall?: (kind: "AUDIO" | "VIDEO") => void;
  /** Forward the text of a message to other chats (the owner of this screen picks them and sends). */
  onForward?: (text: string) => void;
  /** People in a group and the chat-wide actions (report, clear, delete, add people). */
  chatActions?: { isGroup: boolean; members: Array<{ name: string; role: string }>; onAddPeople?: () => void; onReport: () => void; onClear: () => void; onDelete: () => void };
}

type View_ = "chat" | "decisions" | "settings" | "verify" | "compose" | "share" | "wallpaper";

/**
 * One conversation and the pages opened from it. The thread lists opened, sealed or unreadable messages; the bottom of
 * the screen is the status (a composer when messaging is LIVE, otherwise the reason it is not, or Unblock when blocked).
 */
export function ConversationScreen(props: ConversationScreenProps) {
  const { conversationId, selfId, peer, service, gate, newId, prefs, blocked } = props;
  const system = useColorScheme();
  const base = resolveTheme(prefs.theme, system);
  const c = useConversation({ conversationId, selfId, service, gate, newId });
  const firstName = peer.displayName.split(/\s+/)[0] ?? peer.displayName;
  const live = c.gateState.mode === "LIVE";
  const [view, setView] = useState<View_>("chat");
  // The lane picker is not on this screen yet, so the lane stays All; typed as Lane so the other branches stay checked.
  const [lane] = useState<Lane>("All");
  const [capture, setCapture] = useState<CaptureKind | null>(null);
  // Pages opened from the "Share with" sheet (Customize, capture panels) lead back to it unless something was attached or sent.
  const returnToShare = useRef(false);
  const captureDone = useRef(false);
  const captureFromShare = useRef(false);
  // A photo or video waits in the composer (with an optional caption) until it is sent or removed. Everything here is scoped to
  // this account and conversation, and a lock or a switch throws the draft away.
  const scopeKey = JSON.stringify([selfId, conversationId]);
  const [mediaDraft, setMediaDraft] = useState<MediaPayload | null>(null);
  const draftRef = useRef<MediaPayload | null>(null);
  const removeMedia = useCallback(() => { const draft = draftRef.current; draftRef.current = null; setMediaDraft(null); if (draft?.localUri) void discardLocalMedia(draft.localUri); }, []);
  useEffect(() => { setCapture(null); removeMedia(); return () => { const draft = draftRef.current; draftRef.current = null; if (draft?.localUri) void discardLocalMedia(draft.localUri); }; }, [scopeKey, removeMedia]);
  useEffect(() => { if (c.gateState.mode === "LOCKED") { setCapture(null); removeMedia(); } }, [c.gateState.mode, removeMedia]);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // A chosen chat background only changes the thread itself; settings and the other pages keep the conversation theme.
  // A wallpaper the person chose wins; otherwise an older fixed background keeps applying, and with neither the default wallpaper shows.
  const wp = props.wallpaper;
  const showWallpaper = Boolean(wp) && (wp!.explicit || prefs.background === "AUTO");
  const t = view === "chat" ? (showWallpaper ? wallpaperTheme(wp!.wallpaper, wp!.dim) : chatTheme(base, prefs.background)) : base;
  const [addOpen, setAddOpen] = useState(false);
  const [startDecision, setStartDecision] = useState(false);
  const [composeKind, setComposeKind] = useState<"EVENT" | "MEETING">("EVENT");
  const [shareKind, setShareKind] = useState<"LOCATION" | "CONTACT">("LOCATION");
  useEffect(() => { setView("chat"); setAddOpen(false); }, [scopeKey]);
  useEffect(() => { if (!live || blocked) { setView(current => current === "share" || current === "compose" ? "chat" : current); } }, [live, blocked]);


  // The phone's back button goes back one page inside the conversation before it leaves it.
  useEffect(() => {
    if (view === "chat" && !searchOpen && !selecting) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { if (view === "chat") { setSearchOpen(false); setSearch(""); setSelecting(false); setSelected([]); } else setView(view === "verify" || view === "wallpaper" ? "settings" : "chat"); return true; });
    return () => sub.remove();
  }, [view, searchOpen, selecting]);

  const items = useMemo(() => buildTimeline(c.messages, lane).filter(item => !search.trim() || (item.kind === "text" ? item.payload.text : item.kind === "card" || item.kind === "board" || item.kind === "share" ? item.payload.title : "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [c.messages, lane, search]);
  const askedAi = useRef(false);
  const askAi = useCallback(() => {
    const readable = buildTimeline(c.messages, "All").filter((item) => item.kind === "text").reverse().slice(-60);
    const lines = readable.map((item) => `${item.message.outgoing ? "Me" : peer.displayName}: ${item.kind === "text" ? item.payload.text : ""}`.slice(0, 1200));
    if (lines.length === 0) {
      Alert.alert("Nothing to share", "There are no readable text messages in this chat yet.");
      props.onAiShareCancelled?.();
      return;
    }
    Alert.alert(
      `Share with Linqa AI?`,
      `${lines.length} recent text message${lines.length === 1 ? "" : "s"} from your chat with ${peer.displayName} will be decrypted on this phone and sent to a cloud AI service to answer your question. Photos and videos are not sent. Nothing is saved.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => props.onAiShareCancelled?.() },
        { text: "Share", onPress: () => props.onAskAi?.({ label: `Chat with ${peer.displayName}`, lines }) }
      ]
    );
  }, [c.messages, peer.displayName, props]);
  useEffect(() => {
    if (!props.aiShareOnOpen || askedAi.current || c.loading || !live) return;
    askedAi.current = true;
    askAi();
  }, [askAi, c.loading, live, props.aiShareOnOpen]);
  const decisions = useMemo(() => buildDecisions(c.messages, selfId, peer.id, firstName), [c.messages, firstName, peer.id, selfId]);

  const sendText = useCallback(async (text: string) => {
    const ok = await c.send({ type: "text", text: text.trim(), lane: lane === "All" ? "General" : lane, ...(replyTo ? { reply: replyTo } : {}) });
    if (ok) setReplyTo(null);
    return ok;
  }, [c, lane, replyTo]);
  // Reply, forward and copy for one message (a long press on it). Dragging it to the right replies too.
  const messageMenu = useCallback((item: TimelineItem) => {
    const quote = replyPreview(item);
    const text = item.kind === "text" ? item.payload.text : null;
    Alert.alert("Message", undefined, [
      ...(quote && live && !blocked ? [{ text: "Reply", onPress: () => setReplyTo(quote) }] : []),
      ...(text && props.onForward && live && !blocked ? [{ text: "Forward", onPress: () => props.onForward!(text) }] : []),
      ...(text ? [{ text: "Copy", onPress: () => { void Clipboard.setStringAsync(text).catch(() => Alert.alert("Copy failed", "Please try again.")); } }] : []),
      { text: "Cancel", style: "cancel" as const }
    ]);
  }, [blocked, live, props]);
  const vote = useCallback((boardId: string, choice: number) => { void c.send({ type: "vote", boardId, choice }); }, [c]);
  const create = useCallback((payload: Payload) => live && !blocked ? c.send(payload) : Promise.resolve(false), [blocked, c, live]);
  const openDecisions = useCallback(() => { setStartDecision(false); setView("decisions"); }, []);
  // The ✦ sheet opens Poll, Event and Meeting forms; capture actions explain their missing integration.
  const canUseActions = live && !blocked;
  const features = useProductionFeatures({ conversationId, selfId, peerId: peer.id, peerName: peer.displayName, service, live: canUseActions, prefs, messages: c.messages,
    send: (payload, id) => canUseActions ? c.send(payload, id) : Promise.resolve(false), retry: c.retry, discard: c.discard,
    onSettings: () => { returnToShare.current = true; setView("settings"); }, onCapture: kind => { captureFromShare.current = true; setCapture(kind); } });
  const pickAction = useCallback((action: ThreadAction) => {
    if (["VOICE", "VIDEO", "PHOTO", "DESIGN"].includes(action)) { setCapture(action as CaptureKind); }
    else if (action === "POLL") { setStartDecision(true); setView("decisions"); }
    else if (action === "EVENT" || action === "MEETING") { setComposeKind(action); setView("compose"); }
    else if (action === "LOCATION" || action === "CONTACT") { setShareKind(action); setView("share"); }
  }, []);

  function tools(action: ComposerAction) {
    if (action === "GIF") setCapture("GIF");
    else if (action === "Search") { setSearchOpen(true); setSelecting(false); }
    else if (action === "Select") { setSelecting(value => !value); setSelected([]); }
    else if (action === "AI") features.openAI();
  }
  async function copySelection() {
    const text = [...items].reverse().filter(item => selected.includes(item.message.id) && item.kind === "text").map(item => item.kind === "text" ? item.payload.text : "").join("\n");
    if (!text) { Alert.alert("Select messages", "Select opened text messages to copy."); return; }
    try { await Clipboard.setStringAsync(text); setSelecting(false); setSelected([]); } catch { Alert.alert("Copy failed", "Please try again."); }
  }
  function confirmBlock() {
    Alert.alert(`Block ${peer.displayName}?`, `${firstName} won't be able to message you or find you. You can unblock ${firstName} any time.`, [
      { text: "Cancel", style: "cancel" }, { text: "Block", style: "destructive", onPress: () => { props.onBlock(); setView("chat"); } }
    ]);
  }
  const notYet = (what: string) => Alert.alert(what, "This isn't available in this version yet.");

  const renderItem = useCallback(({ item }: { item: TimelineItem }) => (
    item.kind === "feature" ? <View>{features.render(item)}{service.deleteMessage?<MessageDeleteButton message={item.message} onDelete={c.deleteMessage} color={t.muted}/>:null}</View> :
    <View style={{ flexDirection: "row", alignItems: "center" }}>{selecting ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(item.message.id), disabled: item.kind !== "text" }} disabled={item.kind !== "text"} onPress={() => setSelected(ids => ids.includes(item.message.id) ? ids.filter(id => id !== item.message.id) : [...ids, item.message.id])} style={{ padding: 12 }}><Text style={{ color: t.accent, fontSize: 22 }}>{selected.includes(item.message.id) ? "☑" : "□"}</Text></Pressable> : null}<View style={{ flex: 1 }}><SwipeToReply enabled={live && !blocked && !selecting && replyPreview(item) !== null} direction={item.message.outgoing ? "left" : "right"} color={t.muted} onReply={() => setReplyTo(replyPreview(item))}><Pressable onLongPress={() => messageMenu(item)} delayLongPress={350} disabled={selecting}><MessageBubble item={item} theme={t} selfId={selfId} peerName={peer.displayName} onOpenMedia={service.openMedia ? payload => service.openMedia!(conversationId, item.message.senderId, payload) : undefined} onRetry={c.retry} onRetryOpen={c.retryOpen} onDiscard={c.discard} {...(live && !blocked ? { onOpenDecisions: openDecisions } : {})} /></Pressable></SwipeToReply>{service.deleteMessage?<MessageDeleteButton message={item.message} onDelete={c.deleteMessage} color={t.muted}/>:null}</View></View>
  ), [blocked, c.deleteMessage, c.discard, c.retry, live, openDecisions, t, selecting, selected, service, conversationId, features, messageMenu, peer.displayName, selfId]);

  const empty = !c.loading && !c.loadError && items.length === 0;
  const noticeEl = props.notice ? <Text accessibilityRole="alert" style={[type.meta, styles.notice, { backgroundColor: t.highlight, color: t.ink }]}>{props.notice}</Text> : null;
  const statusBar = <StatusBar style={t.ink === THEMES.dark.ink ? "light" : "dark"} />;

  if (view === "share") return <SafeAreaView style={[styles.fill, { backgroundColor: t.surface }]}>{statusBar}{noticeEl}<SharedAttachmentForm key={scopeKey + shareKind} kind={shareKind} theme={t} peerFirstName={firstName} onSend={create} onBack={() => setView("chat")} /></SafeAreaView>;
  if (view === "compose") {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: t.surface }]}>{statusBar}
        {noticeEl}
        <CardFormView theme={t} kind={composeKind} peerFirstName={firstName} onSend={create} onBack={() => setView("chat")} />
      </SafeAreaView>
    );
  }
  if (view === "decisions") {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: t.surface }]}>{statusBar}
        {noticeEl}
        <DecisionsView theme={t} peerName={peer.displayName} peerFirstName={firstName} live={live && !blocked} decisions={decisions} onVote={vote} onCreate={create} onBack={() => setView("chat")} startCreating={startDecision} />
      </SafeAreaView>
    );
  }
  if (view === "verify") {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: t.surface }]}>{statusBar}
        {noticeEl}
        <SafetyNumberView theme={t} peerName={peer.displayName} peerFirstName={firstName} numbers={props.safetyNumber} verified={prefs.verified} onMarkVerified={() => props.onPrefsChange({ ...prefs, verified: true })} onBack={() => setView("settings")} />
      </SafeAreaView>
    );
  }
  if (view === "wallpaper" && wp) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: t.surface }]}>{statusBar}
        <WallpaperPicker theme={t} state={wp} scope="chat" chatName={firstName} onBack={() => setView("settings")} />
      </SafeAreaView>
    );
  }
  if (view === "settings") {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: t.surface }]}>{statusBar}
        {noticeEl}
        <SettingsView theme={t} peerName={peer.displayName} peerId={peer.id} peerFirstName={firstName} gate={c.gateState} prefs={prefs} featureSupport={features.featureSupport} blocked={Boolean(blocked)} pinned={props.pinned} disappearAfterSeconds={props.disappearAfterSeconds} onPinnedChange={props.onPinnedChange} onDisappearChange={props.onDisappearChange} onChange={props.onPrefsChange} onVerify={() => setView("verify")} onBlock={confirmBlock} onUnblock={props.onUnblock} onAskAi={props.onAskAi && live ? askAi : undefined} chat={props.chatActions} wallpaper={wp?.wallpaper} onOpenWallpaper={wp ? () => setView("wallpaper") : undefined} onBack={() => { setView("chat"); if (returnToShare.current) { returnToShare.current = false; features.reopen(); } }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.surface }]}>
      {statusBar}
      <ConversationHeader peer={peer} gate={c.gateState} theme={t} blocked={Boolean(blocked)} onBack={props.onBack} onOpenSettings={() => { returnToShare.current = false; setView("settings"); }} onSearch={() => { setSearchOpen(true); setSelecting(false); }} onCall={props.onCall} />

      {searchOpen ? <View style={{ flexDirection: "row", backgroundColor: t.surface, padding: 10, alignItems: "center", gap: 10 }}><TextInput autoFocus accessibilityLabel="Search opened messages" value={search} onChangeText={setSearch} placeholder="Search messages" placeholderTextColor={t.muted} style={{ flex: 1, color: t.ink, padding: 8 }} /><Pressable onPress={() => { setSearchOpen(false); setSearch(""); }}><Text style={{ color: t.accent, padding: 10 }}>Done</Text></Pressable></View> : null}
      {selecting ? <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 12, backgroundColor: t.surface }}><Text style={{ color: t.ink }}>{selected.length} selected</Text><Pressable onPress={() => void copySelection()}><Text style={{ color: t.accent }}>Copy text</Text></Pressable><Pressable onPress={() => { setSelecting(false); setSelected([]); }}><Text style={{ color: t.accent }}>Done</Text></Pressable></View> : null}


      <KeyboardAvoidingView style={[styles.fill, { backgroundColor: t.background }]} behavior="padding">
        {showWallpaper ? <WallpaperBackground testID="chat-wallpaper-canvas" wallpaper={wp!.wallpaper} dim={wp!.dim} /> : null}
        {props.notice ? <Text accessibilityRole="alert" style={[type.meta, styles.notice, { backgroundColor: t.highlight, color: t.ink }]}>{props.notice}</Text> : null}
        {props.rejectedOutbox ? <RejectedMessagesPanel outbox={props.rejectedOutbox} conversationId={conversationId} enabled={live} /> : null}
        {c.loadError && !blocked ? (
          <View style={[styles.noticeRow, { backgroundColor: t.warnSurface }]}>
            <Text style={[type.meta, { color: "#302342", flex: 1 }]}>Couldn't load messages.</Text>
            <Pressable onPress={c.reload} accessibilityRole="button" hitSlop={8}><Text style={[type.meta, { color: t.warn, fontWeight: "600" }]}>Try again</Text></Pressable>
          </View>
        ) : null}

        {empty && !blocked ? (
          <View style={styles.empty}>
            <Text style={[type.title, { color: t.ink, textAlign: "center" }]}>{search.trim() ? "No matching opened messages" : lane === "All" ? "No messages yet" : `No ${lane.toLowerCase()} messages yet`}</Text>
            <Text style={[type.body, { color: t.muted, textAlign: "center", marginTop: space.s }]}>
              {search.trim() ? (live ? "Try another search." : "Messages become searchable once this device can open them.") : live ? `Start the conversation with ${firstName}.` : `You can start the conversation with ${firstName} once secure messaging is available on this device.`}
            </Text>
          </View>
        ) : (
          <FlatList
            testID="message-list"
            inverted
            data={items}
            keyExtractor={(i) => i.message.id}
            renderItem={renderItem}
            onEndReached={c.loadOlder}
            onEndReachedThreshold={0.4}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={blocked ? <View style={styles.systemRow}><Text style={[type.meta, styles.system, { backgroundColor: t.line, color: t.ink }]}>{`You blocked ${firstName}${blocked.at ? ` at ${new Date(blocked.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`}</Text></View> : null}
            ListFooterComponent={c.loading ? <ActivityIndicator style={{ margin: space.l }} color={t.muted} /> : null}
          />
        )}

        {blocked ? (
          <View testID="blocked-sheet" style={[styles.sheet, { backgroundColor: t.surface }]}>
            <Text accessibilityRole="header" style={[type.title, styles.sheetTitle, { color: t.ink }]}>You blocked {firstName}</Text>
            <Text style={[type.body, { color: t.muted, textAlign: "center" }]}>{firstName} can't message you or see when you read messages. They aren't told they were blocked.</Text>
            <Pressable accessibilityRole="button" onPress={props.onUnblock} style={[styles.sheetButton, { backgroundColor: t.accent }]}><Text style={[type.title, { color: t.onAccent }]}>Unblock</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => notYet("Delete chat")} style={[styles.sheetButton, { borderWidth: 1.5, borderColor: t.danger }]}><Text style={[type.title, { color: t.danger }]}>Delete chat</Text></Pressable>
          </View>
        ) : (
          <>
            {live ? <Text style={[type.meta, styles.secured, { color: t.muted }]}>{props.disappearAfterSeconds ? `Messages disappear after ${disappearLabel(props.disappearAfterSeconds)}. ` : ""}Messages and calls are secured with end-to-end encryption.</Text> : null}
          {replyTo ? <ReplyBar reply={replyTo} who={replyTo.senderId === selfId ? "yourself" : peer.displayName} theme={t} onCancel={() => setReplyTo(null)} /> : null}
          <ComposerArea key={scopeKey} scopeKey={scopeKey} draft={mediaDraft} onRemoveMedia={removeMedia} onSendMedia={async payload => { if (!live || blocked) return false; await create(payload); if (draftRef.current?.mediaId === payload.mediaId) { draftRef.current = null; setMediaDraft(null); } return true; }} gate={c.gateState} theme={t} peerFirstName={firstName} onSend={sendText} onRecheck={c.recheck} onAdd={features.open} onOpenAttachments={features.open} onTools={tools} onRecord={setCapture} onAction={pickAction} canUseActions={canUseActions} />
          </>
        )}
      </KeyboardAvoidingView>
      {capture ? <CapturePanel key={scopeKey + capture} onAttach={capture === "PHOTO" || capture === "VIDEO" || capture === "GALLERY" ? payload => { captureDone.current = true; removeMedia(); draftRef.current = payload; setMediaDraft(payload); } : undefined} kind={capture} theme={t} canSend={canUseActions} onSend={async payload => { captureDone.current = true; return create(payload); }} onClose={() => { setCapture(null); if (captureFromShare.current && !captureDone.current) features.reopen(); captureDone.current = false; captureFromShare.current = false; }} /> : null}
      {features.overlays}
      <AddSheet localActions={["VOICE", "VIDEO", "PHOTO", "DESIGN"]} visible={addOpen} theme={t} enabled={prefs.features} canUse={canUseActions} onPick={pickAction} onClose={() => setAddOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  listContent: { paddingVertical: space.s },
  lanes: { flexDirection: "row", gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s, borderBottomWidth: StyleSheet.hairlineWidth },
  lane: { minHeight: 44, paddingHorizontal: space.l, borderRadius: radius.control, alignItems: "center", justifyContent: "center" },
  notice: { padding: space.m },
  secured: { textAlign: "center", paddingVertical: space.s, paddingHorizontal: space.l },
  noticeRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.l, paddingVertical: space.s },
  empty: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl * 1.5 },
  systemRow: { alignItems: "center", marginVertical: space.m },
  system: { paddingHorizontal: space.l, paddingVertical: space.s, borderRadius: radius.control, overflow: "hidden" },
  sheet: { padding: space.l, gap: space.m, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetTitle: { textAlign: "center", fontSize: 20 },
  sheetButton: { minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" }
});

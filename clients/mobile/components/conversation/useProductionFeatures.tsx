import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Modal, Platform, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as FS from "expo-file-system/legacy";
import { AccountSecureStorage } from "../../account/AccountSecureStorage";
import { createFeatureAttachments } from "../../features/conversation/attachments/production-adapter";
import { useAttachFlow } from "../../features/conversation/attach/useAttachFlow";
import type { AttachAction, ChatFeatures } from "../../features/conversation/attach/AttachSheet";
import { ContentBubble } from "../../features/conversation/render/ContentBubble";
import { indexThread } from "../../features/conversation/render/threadIndex";
import { DocumentViewer } from "../../features/conversation/documents/DocumentViewer";
import { LiveSession } from "../../features/conversation/live/LiveSession";
import { LiveSessionScreen } from "../../features/conversation/live/LiveSessionScreen";
import { newId, validateContent } from "../../features/conversation/content/codec";
import type { ContentTransport, FileContent, MessageContent } from "../../features/conversation/content/types";
import type { AiImageProvider } from "../../features/conversation/features/ai/AiImage";
import type { ConversationServiceLike, DisplayMessage } from "../../services/conversation-types";
import type { ConversationPrefs, Payload } from "../../services/conversation-engine";
import { featureMessages, type TimelineItem } from "../../services/conversation-state";
import type { CaptureKind } from "./CapturePanel";

const storage = new AccountSecureStorage();
const ACTIONS: Partial<Record<AttachAction, ConversationPrefs["features"][number]>> = {
  photos: "PHOTO", camera: "PHOTO", document: "DOCUMENT", design: "DESIGN", location: "LOCATION", contact: "CONTACT", poll: "POLL", event: "EVENT", meeting: "MEETING", voice: "VOICE", video: "VIDEO", screen: "LIVE_SCREEN", whiteboard: "LIVE_SCREEN", ai: "AI_IMAGE"
};

export function useProductionFeatures(o: {
  conversationId: string; selfId: string; peerId: string | null; peerName: string;
  service: ConversationServiceLike; live: boolean; prefs: ConversationPrefs; messages: DisplayMessage[];
  send: (payload: Payload, id?: string) => Promise<boolean>; retry: (id: string) => void; discard: (id: string) => void;
  onSettings: () => void; onCapture: (kind: CaptureKind) => void;
}) {
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [file, setFile] = useState<FileContent | null>(null);
  const [session, setSession] = useState<LiveSession | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const [capabilities, setCapabilities] = useState({ aiImages: false, live: false });
  const [consented, setConsented] = useState(false);
  const alive = useRef(true);
  const live = o.live && foreground;
  const liveRef = useRef(live); liveRef.current = live;
  const sendRef = useRef(o.send); sendRef.current = o.send;
  const seenSignals = useRef(new Set<string>());
  const signalQueue = useRef(Promise.resolve());
  const generatedPaths = useRef(new Set<string>());
  const attachments = useMemo(() => createFeatureAttachments(o.service, o.conversationId, () => liveRef.current && alive.current), [o.service, o.conversationId]);
  const transport = useMemo<ContentTransport>(() => ({ async sendContent(conversationId, content) {
    if (!alive.current || !liveRef.current || conversationId !== o.conversationId || !validateContent(content)) throw new Error("SECURE_CORE_UNAVAILABLE");
    const id = newId();
    if (!await sendRef.current({ type: "feature", content }, id)) throw new Error("NOT_SENT");
    return { id, sentAt: new Date().toISOString() };
  } }), [o.conversationId]);
  const stopLive = useCallback(() => {
    const current = sessionRef.current; sessionRef.current = null; setSession(null);
    if (current) { void current.end(); if (liveRef.current && alive.current) void transport.sendContent(o.conversationId, { type: "live_session", sessionId: current.sessionId, state: "ended" }).catch(() => undefined); }
  }, [o.conversationId, transport]);
  const wipe = useCallback(() => {
    setFile(null); stopLive(); seenSignals.current.clear();
    void attachments.wipeOpened();
    for (const path of generatedPaths.current) void FS.deleteAsync(path, { idempotent: true }).catch(() => undefined);
    generatedPaths.current.clear();
  }, [attachments, stopLive]);
  useEffect(() => {
    alive.current = true;
    const sub = AppState.addEventListener("change", state => { if (state !== "active") { liveRef.current = false; wipe(); } setForeground(state === "active"); });
    return () => { alive.current = false; liveRef.current = false; sub.remove(); wipe(); };
  }, [wipe]);
  useEffect(() => { if (!live) wipe(); }, [live, wipe]);
  useEffect(() => {
    let active = true;
    setCapabilities({ aiImages: false, live: false }); setConsented(false);
    if (live) void o.service.featureCapabilities?.(o.conversationId).then(value => { if (active) setCapabilities(value); }).catch(() => undefined);
    void storage.get(o.selfId, "chat-ai-consent-v1").then(value => { if (active) setConsented(value === "accepted"); }).catch(() => undefined);
    return () => { active = false; };
  }, [o.service, o.conversationId, o.selfId, live]);
  const startLive = useCallback(async (opts: { sessionId: string; screen?: boolean; board?: boolean; meetingId?: string; joining?: boolean }) => {
    if (!liveRef.current || !o.peerId || !o.service.featureIceServers || sessionRef.current) return;
    try {
      const iceServers = await o.service.featureIceServers(o.conversationId);
      if (!liveRef.current || !alive.current || sessionRef.current) return;
      const current = await LiveSession.create({ sessionId: opts.sessionId, conversationId: o.conversationId, selfId: o.selfId, peerId: o.peerId, transport, iceServers, audio: true, video: !opts.board && !opts.screen });
      if (!liveRef.current || !alive.current || sessionRef.current) { await current.end(false); return; }
      sessionRef.current = current; seenSignals.current.clear();
      if (!opts.joining) await transport.sendContent(o.conversationId, { type: "live_session", sessionId: opts.sessionId, state: "started", meetingId: opts.meetingId });
      if (opts.board) current.setBoardOpen(true);
      setSession(current);
      await current.start();
      if (!liveRef.current || !alive.current || sessionRef.current !== current) { await current.end(false); return; }
      // Screen capture starts only from the call's explicit system-permission flow.
    } catch { stopLive(); Alert.alert("Couldn't start", "Check your connection, camera and microphone access, and the calling service."); }
  }, [o.conversationId, o.peerId, o.selfId, o.service, stopLive, transport]);
  const messages = useMemo(() => featureMessages(o.messages), [o.messages]);
  const index = useMemo(() => indexThread(messages), [messages]);
  useEffect(() => {
    if (!session || !live) return;
    const relevant = messages.filter(m => m.senderId === o.peerId && m.content.type === "rtc_signal" && m.content.sessionId === session.sessionId && !seenSignals.current.has(m.id)).sort((a,b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id));
    for (const m of relevant) {
      seenSignals.current.add(m.id);
      if (m.content.type !== "rtc_signal") continue;
      const signal = m.content;
      signalQueue.current = signalQueue.current.then(async () => { if (sessionRef.current === session && liveRef.current) await session.handleSignal(signal, m.senderId); }).catch(() => { stopLive(); });
    }
  }, [live, messages, o.peerId, session, stopLive]);
  const aiProvider = useMemo<AiImageProvider>(() => ({ async generate({ prompt, style }) {
    if (!liveRef.current || !o.service.generateFeatureImage) throw new Error("AI_PROVIDER_UNAVAILABLE");
    const images = await o.service.generateFeatureImage(o.conversationId, prompt, style);
    const results: { uri: string; width: number; height: number }[] = [];
    for (const image of images) {
      if (!liveRef.current || !alive.current) throw new Error("SECURE_CORE_UNAVAILABLE");
      const uri = `${FS.cacheDirectory}linqa-ai-${newId()}.${image.mime === "image/png" ? "png" : image.mime === "image/jpeg" ? "jpg" : "webp"}`;
      generatedPaths.current.add(uri);
      await FS.writeAsStringAsync(uri, image.base64, { encoding: FS.EncodingType.Base64 });
      if (!liveRef.current || !alive.current) { await FS.deleteAsync(uri, { idempotent: true }); throw new Error("SECURE_CORE_UNAVAILABLE"); }
      const manipulator = await import("expo-image-manipulator");
      const normalized = await manipulator.manipulateAsync(uri, [], { format: manipulator.SaveFormat.PNG });
      generatedPaths.current.add(normalized.uri);
      if (!liveRef.current || !alive.current) { await FS.deleteAsync(normalized.uri, { idempotent: true }); throw new Error("SECURE_CORE_UNAVAILABLE"); }
      results.push({ uri: normalized.uri, width: normalized.width, height: normalized.height });
    }
    return results;
  } }), [o.service, o.conversationId]);
  const features: ChatFeatures = { media: true, voice: true, location: true, polls: true, meetings: true, screen: capabilities.live, ai: capabilities.aiImages };
  const supported = (Object.keys(ACTIONS) as AttachAction[]).filter(action => (action !== "ai" || capabilities.aiImages) && (!["screen", "whiteboard"].includes(action) || capabilities.live) && (action !== "screen" || Platform.OS === "android"));
  const featureSupport = [...new Set(supported.map(action => ACTIONS[action]!))];
  const allowedActions = supported.filter(action => o.prefs.features.includes(ACTIONS[action]!));
  const flow = useAttachFlow({ conversationId: o.conversationId, peerName: o.peerName, live, features, allowedActions, transport, attachments, aiProvider, aiConsented: consented,
    onAiConsent: () => { setConsented(true); void storage.put(o.selfId, "chat-ai-consent-v1", "accepted").catch(() => undefined); }, showNotificationPreviews: false,
    onOpenSettings: o.onSettings, onCapture: kind => o.onCapture(kind), onStartLive: opts => { void startLive(opts); } });
  const openAI = () => {
    if (!o.prefs.features.includes("AI_IMAGE")) { o.onSettings(); return; }
    if (!capabilities.aiImages) { Alert.alert("AI images unavailable", "The image provider is not configured."); return; }
    void flow.pickAction("ai").catch(() => Alert.alert("Couldn't open", "Try again after unlocking secure messaging."));
  };
  return {
    open: flow.open, openAI, featureSupport,
    render: (item: Extract<TimelineItem, {kind:"feature"}>) => <View style={{ padding: 12, alignItems: item.message.outgoing ? "flex-end" : "flex-start" }}>
      <ContentBubble message={{ id: item.message.id, senderId: item.message.senderId, sentAt: item.message.sentAt, outgoing: item.message.outgoing, content: item.payload.content }} index={index} selfId={o.selfId} peerName={o.peerName} nameOf={id => id === o.selfId ? "You" : o.peerName} attachments={attachments} send={async content => { await flow.sendContent(content); }} onOpenFile={file => { if (liveRef.current) setFile(file); }} onJoinLive={id => {
        if (sessionRef.current) return;
        if (item.payload.content.type === "meeting") {
          const active = [...messages].reverse().find(m => m.content.type === "live_session" && m.content.meetingId === id && m.content.state === "started" && !index.endedSessions.has(m.content.sessionId) && Date.now() - Date.parse(m.sentAt) < 75_000);
          void startLive({sessionId:active?.content.type === "live_session" ? active.content.sessionId : newId("live"),meetingId:id,joining:!!active});
        } else if (Date.now() - Date.parse(item.message.sentAt) < 75_000) void startLive({sessionId:id,joining:true});
        else Alert.alert("Call has expired", "Start a new call from the attachment menu.");
      }} />
      <Text style={{ color: "#667078", marginTop: 4 }}>{item.message.delivery === "sending" ? "Sending…" : new Date(item.message.sentAt).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</Text>
      {item.message.delivery === "failed" ? <View><Text accessibilityRole="alert" style={{ color: "#A8641A" }}>{item.message.failure ?? "Not sent"}</Text><Pressable onPress={() => o.retry(item.message.id)} style={{padding:12}}><Text>Retry</Text></Pressable><Pressable onPress={() => o.discard(item.message.id)} style={{padding:12}}><Text>Discard</Text></Pressable></View> : null}
    </View>,
    overlays: <>{flow.overlays}<Modal visible={!!file && live} onRequestClose={() => setFile(null)}>{file && live ? <GestureHandlerRootView style={{flex:1}}><DocumentViewer file={file} attachments={attachments} onSendNewVersion={input => flow.sendFiles([input])} onClose={() => setFile(null)} /></GestureHandlerRootView> : null}</Modal><Modal visible={!!session && live} onRequestClose={stopLive}>{session && live ? <GestureHandlerRootView style={{flex:1}}><LiveSessionScreen session={session} selfId={o.selfId} selfName="You" peerName={o.peerName} onSaveBoard={input => flow.sendFiles([input])} onLeave={stopLive} /></GestureHandlerRootView> : null}</Modal></>
  };
}

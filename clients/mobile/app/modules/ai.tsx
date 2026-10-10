import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { getApiBaseUrl } from "../../config/api";
import { askAssistant, AssistantError, takeHandOff, takeImageHandOff, type AssistantImage, type AssistantMessage, type SharedContext } from "../../services/assistant.service";
import { ChatInboxService, type ChatSummary } from "../../services/chat-inbox.service";
import { dictationAvailable, startDictation } from "../../services/dictation";
import { HomeFeedService } from "../../services/home-feed.service";
import { accessTokenProvider } from "../../services/session";
import { SettingsService, type UserSettings } from "../../services/settings.service";
import { loadRecordings } from "../../services/call-recordings";

const PURPLE = "#5B4CFF";
const INK = "#0F172A";
const MUTED = "#64748B";
const API = getApiBaseUrl();

type Turn = AssistantMessage & { id: string; image?: string; error?: boolean };

const SUGGESTIONS = [
  "What can Linqa do?",
  "Help me write a message to a friend who has not replied",
  "How do I record a call and get a transcript?",
  "Plan an event: a team meeting next week, with an agenda"
];

/** Linqa AI: ask questions about Linqa, draft messages, or work on a chat / photo you choose to share. Types, speaks or looks. */
export default function LinqaAiScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; q?: string }>();
  const settingsService = useMemo(() => new SettingsService(API, accessTokenProvider), []);
  const inbox = useMemo(() => new ChatInboxService(API, () => accessTokenProvider.getAccessToken()), []);
  const home = useMemo(() => new HomeFeedService(API, () => accessTokenProvider.getAccessToken()), []);

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<SharedContext | null>(null);
  const [image, setImage] = useState<{ data: AssistantImage; uri: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [counts, setCounts] = useState<{ unreadMessages?: number; pendingMessageRequests?: number; missedCalls?: number; recordingCount?: number }>({});
  const stopListening = useRef<(() => void) | null>(null);
  const list = useRef<FlatList<Turn>>(null);
  const textRef = useRef("");
  textRef.current = text;

  const enabled = settings?.aiMode === "CONFIDENTIAL_CLOUD";

  // Settings, the shared chat (if this screen was opened from one), and the counts the assistant may know about.
  useEffect(() => {
    settingsService.getUserSettings().then(setSettings, () => setSettingsError("Could not load your AI setting."));
    void Promise.allSettled([home.loadFeed(), loadRecordings()]).then(([feed, recordings]) => {
      setCounts({
        ...(feed.status === "fulfilled" && feed.value.notifications ? {
          unreadMessages: feed.value.notifications.unreadMessages,
          pendingMessageRequests: feed.value.notifications.pendingMessageRequests,
          missedCalls: feed.value.notifications.missedCalls
        } : {}),
        ...(recordings.status === "fulfilled" ? { recordingCount: recordings.value.length } : {})
      });
    });
  }, [home, settingsService]);

  // A chat shared from its own screen arrives while this screen is behind it, so it is picked up whenever this screen is shown again.
  useFocusEffect(useCallback(() => {
    const photo = takeImageHandOff();
    if (photo) {
      setImage({ data: photo, uri: `data:${photo.mimeType};base64,${photo.dataBase64}` });
      if (!textRef.current.trim()) setText("What is in this photo, and how can I use it in Linqa?");
    }
    const handedOff = takeHandOff();
    if (handedOff) {
      setShared(handedOff);
      if (!textRef.current.trim()) setText("Summarise this chat and list anything I need to do or reply to.");
    }
  }, []));

  const turnOn = useCallback(() => {
    if (!settings) return;
    const next = { ...settings, aiMode: "CONFIDENTIAL_CLOUD" as const };
    setSettings(next);
    settingsService.saveUserSettings(next).catch(() => { setSettings(settings); setSettingsError("Could not save that. Try again."); });
  }, [settings, settingsService]);

  const send = useCallback(async (override?: string) => {
    const question = (override ?? textRef.current).trim();
    if (!question || busy || !enabled) return;
    stopListening.current?.();
    const attached = image;
    const user: Turn = { id: `u${Date.now()}`, role: "user", text: question, ...(attached ? { image: attached.uri } : {}) };
    const history = [...turns, user];
    setTurns(history);
    setText("");
    setImage(null);
    setBusy(true);
    try {
      const reply = await askAssistant({
        messages: history.filter((turn) => !turn.error).map(({ role, text: body }) => ({ role, text: body })),
        shared,
        image: attached?.data ?? null,
        appContext: counts
      });
      setTurns((current) => [...current, { id: `a${Date.now()}`, role: "assistant", text: reply }]);
    } catch (error) {
      if (error instanceof AssistantError && error.code === "AI_DISABLED") setSettings((current) => current ? { ...current, aiMode: "DISABLED" } : current);
      setTurns((current) => [...current, { id: `e${Date.now()}`, role: "assistant", text: error instanceof Error ? error.message : "Something went wrong.", error: true }]);
    } finally {
      setBusy(false);
    }
  }, [busy, counts, enabled, image, shared, turns]);

  const toggleVoice = useCallback(async (autoSend = false) => {
    if (listening) { stopListening.current?.(); return; }
    setVoiceError(null);
    try {
      setListening(true);
      stopListening.current = await startDictation((spoken, final) => {
        setText(spoken);
        if (final) {
          setListening(false);
          stopListening.current = null;
          if (autoSend && spoken.trim()) void send(spoken);
        }
      });
    } catch (error) {
      setListening(false);
      setVoiceError(error instanceof Error ? error.message : "Voice input could not start.");
    }
  }, [listening, send]);

  // Opened from the home screen's Voice or Camera button.
  const startedFrom = useRef(false);
  useEffect(() => {
    if (startedFrom.current || !enabled) return;
    startedFrom.current = true;
    if (params.mode === "voice" && dictationAvailable()) void toggleVoice(true);
    if (params.mode === "camera") setCameraOpen(true);
    if (params.q) void send(String(params.q));
  }, [enabled, params.mode, params.q, send, toggleVoice]);
  useEffect(() => () => { stopListening.current?.(); }, []);
  useEffect(() => { if (turns.length) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 60); }, [turns, busy]);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
    if (!chats) void inbox.inbox("all").then((result) => setChats(result.conversations), () => setChats([]));
  }, [chats, inbox]);

  const pickChat = (chat: ChatSummary) => {
    setPickerOpen(false);
    router.push({ pathname: "/modules/conversation", params: { conversationId: chat.conversationId, name: chat.title, aiShare: "1" } });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={INK} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>Linqa AI</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="AI privacy settings" onPress={() => router.push("/settings/ai-privacy")} hitSlop={10}>
          <Ionicons name="shield-checkmark-outline" size={22} color={INK} />
        </Pressable>
      </View>

      {!settings && !settingsError ? <ActivityIndicator style={{ marginTop: 40 }} color={PURPLE} /> : null}
      {settingsError ? <Text style={styles.error}>{settingsError}</Text> : null}

      {settings && !enabled ? (
        <View style={styles.gate}>
          <Ionicons name="sparkles" size={34} color={PURPLE} />
          <Text style={styles.gateTitle}>Turn on Linqa AI</Text>
          <Text style={styles.gateBody}>Linqa AI answers questions about LinqaChat and can help with chats and photos you choose to share.</Text>
          <Text style={styles.gateBody}>Only what you type, say, or share with it is sent to LinqaChat’s cloud AI service for a response. It never sees your other chats, and your messages stay end-to-end encrypted everywhere else.</Text>
          <Text style={styles.gateBody}>You can turn this off anytime in AI privacy.</Text>
          <Pressable accessibilityRole="button" onPress={turnOn} style={styles.primary}><Text style={styles.primaryText}>Turn on Linqa AI</Text></Pressable>
        </View>
      ) : null}

      {enabled ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <FlatList
            ref={list}
            data={turns}
            keyExtractor={(turn) => turn.id}
            contentContainerStyle={styles.thread}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={turns.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Ask me about Linqa</Text>
                <Text style={styles.emptyBody}>I can explain features, draft messages, and summarise a chat or photo you share. I only help with Linqa.</Text>
                <View style={styles.chips}>
                  {SUGGESTIONS.map((suggestion) => (
                    <Pressable key={suggestion} accessibilityRole="button" onPress={() => void send(suggestion)} style={styles.chip}><Text style={styles.chipText}>{suggestion}</Text></Pressable>
                  ))}
                  <Pressable accessibilityRole="button" onPress={openPicker} style={[styles.chip, styles.chipStrong]}><Text style={[styles.chipText, { color: "#FFFFFF" }]}>Summarise a chat…</Text></Pressable>
                </View>
              </View>
            ) : null}
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.role === "user" ? styles.mine : styles.theirs, item.error && styles.failed]}>
                {item.image ? <Image source={{ uri: item.image }} style={styles.thumb} /> : null}
                <Text selectable style={[styles.bubbleText, item.role === "user" && { color: "#FFFFFF" }]}>{item.text}</Text>
              </View>
            )}
            ListFooterComponent={busy ? <View style={[styles.bubble, styles.theirs]}><ActivityIndicator color={PURPLE} /></View> : null}
          />

          {shared ? (
            <View style={styles.sharedBar}>
              <Ionicons name="chatbubbles-outline" size={16} color={PURPLE} />
              <Text numberOfLines={1} style={styles.sharedText}>Sharing: {shared.label} ({shared.lines.length} messages)</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Stop sharing" onPress={() => setShared(null)} hitSlop={10}><Ionicons name="close" size={18} color={MUTED} /></Pressable>
            </View>
          ) : null}
          {image ? (
            <View style={styles.sharedBar}>
              <Image source={{ uri: image.uri }} style={styles.preview} />
              <Text style={styles.sharedText}>Photo attached</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setImage(null)} hitSlop={10}><Ionicons name="close" size={18} color={MUTED} /></Pressable>
            </View>
          ) : null}
          {voiceError ? <Text style={styles.error}>{voiceError}</Text> : null}

          <View style={styles.composer}>
            <Pressable accessibilityRole="button" accessibilityLabel="Share a chat with Linqa AI" onPress={openPicker} style={styles.round}><Ionicons name="chatbubbles-outline" size={20} color={PURPLE} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Take a photo for Linqa AI" onPress={() => setCameraOpen(true)} style={styles.round}><Ionicons name="camera-outline" size={21} color={PURPLE} /></Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={listening ? "Listening…" : "Ask Linqa AI"}
              placeholderTextColor="#94A3B8"
              multiline
              style={styles.input}
              editable={!busy}
            />
            {dictationAvailable() ? (
              <Pressable accessibilityRole="button" accessibilityLabel={listening ? "Stop listening" : "Speak to Linqa AI"} onPress={() => void toggleVoice(false)} style={[styles.round, listening && { backgroundColor: "#FEE4E2" }]}>
                <Ionicons name={listening ? "stop" : "mic-outline"} size={21} color={listening ? "#D92D20" : PURPLE} />
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={busy || !text.trim()} onPress={() => void send()} style={[styles.send, (busy || !text.trim()) && { opacity: 0.4 }]}>
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      <CameraModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onPhoto={(data, uri) => { setImage({ data, uri }); setCameraOpen(false); if (!textRef.current.trim()) setText("What is in this photo, and how can I use it in Linqa?"); }}
      />

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <Pressable accessible={false} style={styles.sheet} onPress={() => undefined}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>Share a chat with Linqa AI</Text>
            <Text style={styles.sheetBody}>Pick a chat. You will see how many messages are sent and confirm before anything leaves this phone.</Text>
            {chats === null ? <ActivityIndicator color={PURPLE} style={{ margin: 24 }} /> : chats.length === 0 ? <Text style={styles.sheetBody}>No chats yet.</Text> : (
              <FlatList
                data={chats}
                keyExtractor={(chat) => chat.conversationId}
                style={{ maxHeight: 360 }}
                renderItem={({ item }) => (
                  <Pressable accessibilityRole="button" onPress={() => pickChat(item)} style={styles.chatRow}>
                    <View style={styles.avatar}><Text style={styles.avatarText}>{item.initials}</Text></View>
                    <Text numberOfLines={1} style={styles.chatName}>{item.title}</Text>
                    <Ionicons name="chevron-forward" size={16} color={MUTED} />
                  </Pressable>
                )}
              />
            )}
            <Pressable accessibilityRole="button" onPress={() => setPickerOpen(false)} style={styles.sheetCancel}><Text style={styles.sheetCancelText}>Cancel</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function CameraModal({ visible, onClose, onPhoto }: { visible: boolean; onClose: () => void; onPhoto: (image: AssistantImage, uri: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (visible && permission && !permission.granted && permission.canAskAgain) void requestPermission(); }, [visible, permission, requestPermission]);

  async function snap() {
    if (!ready || busy || !camera.current) return;
    setBusy(true);
    setError(null);
    try {
      // The photo is read straight into memory as base64 and never written to storage.
      const shot = await camera.current.takePictureAsync({ base64: true, quality: 0.5, skipProcessing: true });
      if (!shot?.base64) throw new Error("empty");
      onPhoto({ mimeType: "image/jpeg", dataBase64: shot.base64 }, `data:image/jpeg;base64,${shot.base64}`);
    } catch {
      setError("The photo could not be taken. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.cameraRoot}>
        {permission?.granted ? (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />
        ) : (
          <View style={styles.cameraDenied}><Text style={styles.cameraDeniedText}>Allow camera access to take a photo for Linqa AI.</Text></View>
        )}
        <SafeAreaView style={styles.cameraUi}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={onClose} style={styles.cameraClose}><Ionicons name="close" size={26} color="#FFFFFF" /></Pressable>
          <View style={styles.cameraBottom}>
            {error ? <Text style={styles.cameraError}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Take photo" disabled={!ready || busy} onPress={() => void snap()} style={[styles.shutter, (!ready || busy) && { opacity: 0.5 }]}>
              <View style={styles.shutterInner} />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6FC" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: INK, fontSize: 19, fontWeight: "700" },
  error: { color: "#B42318", paddingHorizontal: 16, paddingVertical: 6 },
  gate: { margin: 20, padding: 22, backgroundColor: "#FFFFFF", borderRadius: 20, gap: 12, alignItems: "flex-start" },
  gateTitle: { color: INK, fontSize: 21, fontWeight: "700" },
  gateBody: { color: MUTED, fontSize: 15, lineHeight: 22 },
  primary: { alignSelf: "stretch", minHeight: 50, borderRadius: 14, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center", marginTop: 6 },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  thread: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { gap: 10, paddingVertical: 12 },
  emptyTitle: { color: INK, fontSize: 24, fontWeight: "800" },
  emptyBody: { color: MUTED, fontSize: 15, lineHeight: 22 },
  chips: { gap: 8, marginTop: 8 },
  chip: { backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#E2E5F5", paddingHorizontal: 14, paddingVertical: 12 },
  chipStrong: { backgroundColor: PURPLE, borderColor: PURPLE },
  chipText: { color: INK, fontSize: 15 },
  bubble: { maxWidth: "88%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  mine: { alignSelf: "flex-end", backgroundColor: PURPLE },
  theirs: { alignSelf: "flex-start", backgroundColor: "#FFFFFF" },
  failed: { backgroundColor: "#FEF3F2" },
  bubbleText: { color: INK, fontSize: 16, lineHeight: 23 },
  thumb: { width: 160, height: 120, borderRadius: 12 },
  sharedBar: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#E9E6FF", borderRadius: 12 },
  sharedText: { flex: 1, color: INK, fontSize: 13 },
  preview: { width: 32, height: 32, borderRadius: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#FFFFFF" },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#EEF0FB", alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderRadius: 20, backgroundColor: "#F1F3FA", paddingHorizontal: 14, paddingVertical: 9, color: INK, fontSize: 16 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 8 },
  sheetTitle: { color: INK, fontSize: 19, fontWeight: "700" },
  sheetBody: { color: MUTED, fontSize: 14, lineHeight: 20 },
  chatRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#E9E6FF", alignItems: "center", justifyContent: "center" },
  avatarText: { color: PURPLE, fontWeight: "700" },
  chatName: { flex: 1, color: INK, fontSize: 16 },
  sheetCancel: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  sheetCancelText: { color: MUTED, fontSize: 16 },
  cameraRoot: { flex: 1, backgroundColor: "#000" },
  cameraDenied: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  cameraDeniedText: { color: "#FFFFFF", fontSize: 16, textAlign: "center" },
  cameraUi: { flex: 1, justifyContent: "space-between" },
  cameraClose: { margin: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: "#0008", alignItems: "center", justifyContent: "center" },
  cameraBottom: { alignItems: "center", paddingBottom: 36, gap: 10 },
  cameraError: { color: "#FFFFFF", backgroundColor: "#0009", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#FFFFFF" }
});

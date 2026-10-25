import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { useKeepAwake } from "expo-keep-awake";
import { useVideoPlayer, VideoView } from "expo-video";
import { useRouter } from "expo-router";
import { useAccounts } from "../account/AccountContext";
import { MediaPreview } from "../components/conversation/MediaPreview";
import { MobileHubService, type HubContact } from "../services/mobile-hub.service";
import { accessTokenProvider } from "../services/session";
import { getApiBaseUrl } from "../config/api";
import { discardLocalMedia } from "../services/conversation-media";
import { MAX_PODCAST_SECONDS, StatusVideoPostError, postStatusVideo, type PostProgress, type StatusVideoPostErrorCode } from "../services/status-video-upload";
import { StatusVideoViewError, openStatusVideo, type FeedItem, type OpenedRecording } from "../services/status-video-view";
import { RuntimeCapabilitiesService } from "../services/runtime-capabilities.service";
import { StatusVideoApi, fileSource, uploadDepsFor, viewDepsFor, wipeOpenedVideos } from "../services/status-video-device";

const PURPLE = "#5B4CFF";
const INK = "#0F172A";
const MUTED = "#64748B";
// ~1.5 Mbit/s video + audio keeps 30 minutes near 360 MB, safely under the 500 MiB ciphertext limit the server accepts.
const VIDEO_BITRATE = 1_500_000;

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s) % 60).padStart(2, "0")}`;

const POST_ERRORS: Record<StatusVideoPostErrorCode, string> = {
  EMPTY: "The recording is empty. Record it again.",
  TOO_LONG: "A podcast can run up to 30 minutes.",
  TOO_LARGE: "This recording is too large to post. Record a shorter one.",
  NO_AUDIENCE: "Choose at least one person to share it with.",
  CANCELLED: "Cancelled. Nothing was posted.",
  STORAGE_FULL: "Your phone is out of storage space. Free some up and try again.",
  UPLOAD_FAILED: "The upload did not finish. Check your connection and try again. Nothing was posted.",
  POST_REJECTED: "The video uploaded, but it could not be shared with that group. Someone may no longer be a contact, or may have blocked you."
};
const VIEW_ERRORS: Record<string, string> = {
  BUNDLE_INVALID: "This video was not shared with this phone.",
  SIZE_MISMATCH: "This video could not be verified and was not opened.",
  DOWNLOAD_FAILED: "The video could not be downloaded. Try again.",
  CORRUPT: "This video failed its security check and was not opened.",
  STORAGE_FULL: "Your phone is out of storage space.",
  CANCELLED: "Cancelled."
};

type Tab = "record" | "watch";

export default function PodcastScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("record");
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={24} color={INK} /></Pressable>
        <Text accessibilityRole="header" style={s.title}>Video podcast</Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={s.tabs}>
        {(["record", "watch"] as const).map((value) => (
          <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[s.tab, tab === value && s.tabOn]}>
            <Ionicons name={value === "record" ? "videocam-outline" : "play-circle-outline"} size={18} color={tab === value ? "#FFFFFF" : PURPLE} />
            <Text style={[s.tabText, tab === value && { color: "#FFFFFF" }]}>{value === "record" ? "Record" : "Watch"}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "record" ? <RecordTab /> : <WatchTab />}
    </SafeAreaView>
  );
}

/** Whether the server can store encrypted videos at all. null while checking; false means posting would fail after a long encrypt. */
function useStorageReady(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    new RuntimeCapabilitiesService(getApiBaseUrl()).snapshot()
      .then((c) => { if (live) setReady(c["object-storage"]?.state === "READY"); }, () => { if (live) setReady(false); });
    return () => { live = false; };
  }, []);
  return ready;
}

function RecordTab() {
  const { active } = useAccounts();
  const selfId = active?.userId ?? "";
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<{ uri: string; mime: string; seconds: number } | null>(null);
  const [contacts, setContacts] = useState<HubContact[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<PostProgress | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const cancel = useRef({ aborted: false });
  const posting = progress !== null;
  const storageReady = useStorageReady();
  useKeepAwake(); // a 30-minute recording or a long upload must not be cut short by the screen locking

  useEffect(() => { if (permission && !permission.granted && permission.canAskAgain) void requestPermission(); }, [permission, requestPermission]);
  useEffect(() => {
    if (!recording) { setElapsed(0); return; }
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [recording]);
  // The camera stops when the app leaves the foreground, so stop cleanly and keep what was recorded.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (value) => { if (value !== "active" && recording) camera.current?.stopRecording(); });
    return () => sub.remove();
  }, [recording]);
  // Anything left unposted is deleted when the screen closes.
  const clipRef = useRef(clip); clipRef.current = clip;
  useEffect(() => () => { if (clipRef.current) void discardLocalMedia(clipRef.current.uri); }, []);

  useEffect(() => {
    if (!clip || contacts) return;
    const hub = new MobileHubService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
    hub.loadHub().then((snapshot) => setContacts(snapshot.contacts), () => setContacts([]));
  }, [clip, contacts]);

  async function record() {
    if (!camera.current || !ready || recording) return;
    setMessage(null);
    if (!micPermission?.granted) { const granted = await requestMic(); if (!granted.granted) { setMessage({ text: "Allow microphone access to record a podcast.", ok: false }); return; } }
    setRecording(true);
    const startedAt = Date.now();
    try {
      const result = await camera.current.recordAsync({ maxDuration: MAX_PODCAST_SECONDS });
      if (!result?.uri) throw new Error("empty");
      const mov = /\.mov$/i.test(result.uri);
      setClip({ uri: result.uri, mime: mov ? "video/quicktime" : "video/mp4", seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)) });
    } catch {
      setMessage({ text: "The recording was not saved. Try again.", ok: false });
    } finally {
      setRecording(false);
    }
  }

  async function discard() {
    if (clip) await discardLocalMedia(clip.uri);
    setClip(null); setChosen(new Set()); setMessage(null);
  }

  async function post() {
    if (!clip || !selfId || posting) return;
    const deps = uploadDepsFor(selfId);
    if (!deps) { setMessage({ text: "Secure messaging is not ready on this phone, so nothing can be shared yet.", ok: false }); return; }
    cancel.current = { aborted: false };
    setMessage(null); setProgress({ phase: "encrypting", fraction: 0 });
    try {
      const done = await postStatusVideo(
        { source: fileSource(clip.uri), mime: clip.mime, durationSeconds: Math.min(clip.seconds, MAX_PODCAST_SECONDS), kind: "PODCAST", ownerUserId: selfId, audienceUserIds: [...chosen] },
        deps, setProgress, cancel.current
      );
      void done;
      const people = chosen.size;
      await discardLocalMedia(clip.uri); // the encrypted copy is posted; the plain recording does not stay behind
      setClip(null); setChosen(new Set());
      setMessage({ text: `Posted for ${people} ${people === 1 ? "person" : "people"}. They can watch it for 24 hours. Take it down any time from Watch.`, ok: true });
    } catch (e) {
      setMessage({ text: e instanceof StatusVideoPostError ? POST_ERRORS[e.code] : "Something went wrong. Nothing was posted.", ok: e instanceof StatusVideoPostError && e.code === "CANCELLED" ? true : false });
    } finally {
      setProgress(null);
    }
  }

  if (!permission?.granted) {
    return <View style={s.center}><Text style={s.hint}>Allow camera access to record a podcast.</Text><Pressable accessibilityRole="button" onPress={() => void requestPermission()} style={s.primary}><Text style={s.primaryText}>Allow camera</Text></Pressable></View>;
  }

  if (clip) {
    return (
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <View style={s.previewBox}><MediaPreview uri={clip.uri} kind="VIDEO" /></View>
        <Text style={s.meta}>{clock(clip.seconds)} recorded. It is encrypted on this phone before it leaves it.</Text>
        {storageReady === false ? <Text accessibilityRole="alert" style={[s.message, { color: "#B54708" }]}>Sharing videos is not available on this server yet, so this can't be posted. Your recording stays on this phone until you leave this screen.</Text> : null}
        <Text style={s.section}>Who can watch?</Text>
        {contacts === null ? <ActivityIndicator color={PURPLE} /> : contacts.length === 0 ? <Text style={s.hint}>You have no contacts to share with yet.</Text> : (
          <FlatList
            data={contacts}
            keyExtractor={(c) => c.id}
            style={{ flexGrow: 0, maxHeight: 220 }}
            renderItem={({ item }) => {
              const on = chosen.has(item.id);
              return (
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: posting }} disabled={posting}
                  onPress={() => setChosen((prev) => { const next = new Set(prev); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} style={[s.row, on && s.rowOn]}>
                  <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? PURPLE : MUTED} />
                  <Text style={s.rowText}>{item.displayName}</Text>
                </Pressable>
              );
            }}
          />
        )}
        {progress ? (
          <View style={s.progress} accessibilityLiveRegion="polite">
            <ActivityIndicator color={PURPLE} />
            <Text style={s.meta}>{({ encrypting: "Encrypting", uploading: "Uploading", sealing: "Securing keys", posting: "Sharing" } as const)[progress.phase]}{progress.phase === "encrypting" || progress.phase === "uploading" ? ` ${Math.round(progress.fraction * 100)}%` : "…"}. Keep Linqa open.</Text>
            <Pressable accessibilityRole="button" onPress={() => { cancel.current.aborted = true; }} style={s.ghost}><Text style={s.ghostText}>Cancel</Text></Pressable>
          </View>
        ) : (
          <>
            <Pressable accessibilityRole="button" disabled={chosen.size === 0 || storageReady !== true} onPress={() => void post()} style={[s.primary, (chosen.size === 0 || storageReady !== true) && { opacity: 0.5 }]}><Text style={s.primaryText}>Post to status</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => void discard()} style={s.ghost}><Text style={s.ghostText}>Discard and record again</Text></Pressable>
          </>
        )}
        {message ? <Text accessibilityRole="alert" style={[s.message, { color: message.ok ? "#067647" : "#B42318" }]}>{message.text}</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={s.cameraFrame}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" mode="video" videoQuality="720p" videoBitrate={VIDEO_BITRATE} onCameraReady={() => setReady(true)} />
        {recording ? <View style={s.recPill}><View style={s.recDot} /><Text style={s.recText}>{clock(elapsed)} / {clock(MAX_PODCAST_SECONDS)}</Text></View> : null}
      </View>
      {message ? <Text accessibilityRole="alert" style={[s.message, { color: message.ok ? "#067647" : "#B42318", textAlign: "center" }]}>{message.text}</Text> : null}
      <Text style={s.meta}>Up to 30 minutes. Only the people you choose can watch, and only after you post.</Text>
      <View style={s.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel={recording ? "Stop recording" : "Start recording"} disabled={!ready} onPress={() => (recording ? camera.current?.stopRecording() : void record())} style={s.shutter}>
          <View style={[s.shutterInner, recording && { borderRadius: 8, width: 30, height: 30 }]} />
        </Pressable>
      </View>
    </View>
  );
}

function WatchTab() {
  const { active } = useAccounts();
  const selfId = active?.userId ?? "";
  const api = useMemo(() => new StatusVideoApi(), []);
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [mine, setMine] = useState<Awaited<ReturnType<StatusVideoApi["mine"]>>["items"]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<OpenedRecording | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // A failed load never shows as "nothing here": that would claim there is no video when there may be one.
  const load = useCallback(async () => {
    try { const [f, m] = await Promise.all([api.feed(), api.mine()]); setFeed(f.filter((x) => x.ownerUserId !== selfId)); setMine(m.items); setMessage(null); setFailed(false); }
    catch { setFailed(true); }
  }, [api, selfId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    new MobileHubService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()).loadHub()
      .then((h) => setNames(Object.fromEntries(h.contacts.map((c) => [c.id, c.displayName]))), () => undefined);
  }, []);
  useEffect(() => () => wipeOpenedVideos(), []); // decrypted copies never outlive this screen

  async function watch(item: FeedItem) {
    const deps = viewDepsFor(selfId);
    if (!deps) { setMessage("Secure messaging is not ready on this phone."); return; }
    setBusy(item.id); setMessage(null);
    try { setPlaying(await openStatusVideo(item, deps)); }
    catch (e) { setMessage(e instanceof StatusVideoViewError ? VIEW_ERRORS[e.code] ?? "This video could not be opened." : "This video could not be opened."); }
    finally { setBusy(null); }
  }
  function closePlayer() { setPlaying(null); wipeOpenedVideos(); }
  async function takeDown(id: string) {
    setBusy(id);
    try { await api.remove(id); await load(); } catch { setMessage("It could not be taken down. Try again."); } finally { setBusy(null); }
  }

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (failed && feed === null) {
    return (
      <View style={s.center}>
        <Text accessibilityRole="alert" style={s.hint}>Videos could not be loaded. Check your connection and try again.</Text>
        <Pressable accessibilityRole="button" onPress={() => void refresh()} style={s.primary}><Text style={s.primaryText}>Try again</Text></Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      {failed ? <Text accessibilityRole="alert" style={[s.message, { color: "#B42318" }]}>Could not refresh. Pull down to try again.</Text> : null}
      {message ? <Text accessibilityRole="alert" style={[s.message, { color: "#B42318" }]}>{message}</Text> : null}
      <Text style={s.section}>Shared with you</Text>
      {feed === null ? <ActivityIndicator color={PURPLE} /> : feed.length === 0 ? <Text style={s.hint}>Nothing has been shared with you.</Text> : feed.map((item) => (
        <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Watch ${names[item.ownerUserId] ?? "a contact"}'s video`} disabled={busy !== null} onPress={() => void watch(item)} style={s.row}>
          <Ionicons name="play-circle" size={28} color={PURPLE} />
          <View style={{ flex: 1 }}>
            <Text style={s.rowText}>{names[item.ownerUserId] ?? "A contact"}{item.viewedAt ? "" : "  ·  new"}</Text>
            <Text style={s.meta}>{clock(item.durationSeconds)}  ·  expires {new Date(item.expiresAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</Text>
          </View>
          {busy === item.id ? <ActivityIndicator color={PURPLE} /> : null}
        </Pressable>
      ))}
      <Text style={s.section}>Your posts</Text>
      {mine.length === 0 ? <Text style={s.hint}>You have no active posts.</Text> : mine.map((item) => (
        <View key={item.id} style={s.row}>
          <Ionicons name="videocam" size={24} color={MUTED} />
          <View style={{ flex: 1 }}>
            <Text style={s.rowText}>{clock(item.durationSeconds)}  ·  {item.viewedByDevices} of {item.deliveredToDevices} devices watched</Text>
            <Text style={s.meta}>expires {new Date(item.expiresAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Take this post down" disabled={busy !== null} onPress={() => void takeDown(item.id)} hitSlop={8}>
            {busy === item.id ? <ActivityIndicator color="#B42318" /> : <Ionicons name="trash-outline" size={22} color="#B42318" />}
          </Pressable>
        </View>
      ))}
      <Modal visible={playing !== null} animationType="slide" onRequestClose={closePlayer}>
        {playing ? <Player uri={playing.uri} onClose={closePlayer} /> : null}
      </Modal>
    </ScrollView>
  );
}

function Player({ uri, onClose }: { uri: string; onClose: () => void }) {
  const player = useVideoPlayer(uri, (p) => { p.play(); });
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <VideoView player={player} style={{ flex: 1 }} nativeControls />
      <Pressable accessibilityRole="button" accessibilityLabel="Close video" onPress={onClose} style={s.close}><Ionicons name="close" size={26} color="#FFFFFF" /></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F6F7FB" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 20, fontWeight: "800", color: INK },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  tab: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: PURPLE, backgroundColor: "#FFFFFF" },
  tabOn: { backgroundColor: PURPLE },
  tabText: { color: PURPLE, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  cameraFrame: { flex: 1, margin: 16, borderRadius: 20, overflow: "hidden", backgroundColor: "#000" },
  recPill: { position: "absolute", top: 14, left: 14, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444" },
  recText: { color: "#FFFFFF", fontWeight: "700" },
  controls: { alignItems: "center", paddingBottom: 18 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: PURPLE, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#D92D20" },
  previewBox: { height: 200, borderRadius: 16, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  section: { fontSize: 15, fontWeight: "800", color: INK, marginTop: 14, marginBottom: 6 },
  meta: { color: MUTED, fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
  hint: { color: MUTED, fontSize: 14, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: "#FFFFFF", marginBottom: 8, borderWidth: 1, borderColor: "#E7E9F2" },
  rowOn: { borderColor: PURPLE },
  rowText: { color: INK, fontSize: 15, fontWeight: "600" },
  primary: { minHeight: 48, borderRadius: 14, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, marginTop: 12 },
  primaryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
  ghost: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  ghostText: { color: PURPLE, fontWeight: "700" },
  progress: { alignItems: "center", gap: 8, marginTop: 14 },
  message: { fontSize: 14, lineHeight: 20, marginTop: 10 },
  close: { position: "absolute", top: 48, right: 18, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
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
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { saveToVault, VaultSaveError } from "../services/vault-save";
import { StatusVideoApi, fileSource, sweepSecureScratch, uploadDepsFor, viewDepsFor, wipeOpenedVideos } from "../services/status-video-device";

const PURPLE = "#5B4CFF";
const INK = "#F5F6FA";
const MUTED = "#9AA0AE";
const BLUE = "#1D6FF2";
const REC = "#E5322D";
const PANEL = "#17181F";
const LINE = "#2A2C36";
/** Session length choices. The server accepts at most 30 minutes (MAX_PODCAST_SECONDS), so there is no longer option. */
const DURATIONS = [15, 30] as const;
// ~1.5 Mbit/s video + audio keeps 30 minutes near 360 MB, safely under the 500 MiB ciphertext limit the server accepts.
const VIDEO_BITRATE = 1_500_000;

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s) % 60).padStart(2, "0")}`;
const clockHms = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${clock(s % 3600)}`;

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
/** LinqaVault accepts files up to 25 MB (see app/recorder.tsx); a full-length podcast is far larger, so only short clips fit. */
const VAULT_MAX_BYTES = 25 * 1024 * 1024;
/**
 * The camera writes into the app's cache folder, and Android empties that folder when the phone is short on space, sometimes within
 * seconds. A recording is therefore copied into permanent storage straight away, in 1 MiB pieces so a 30-minute file never has to
 * fit in memory. The name starts with "linqa-capture-" so discardLocalMedia() removes it later. The cache original is deleted only
 * after the copy has the same size.
 */
async function keepRecording(uri: string, suffix: "mp4" | "mov"): Promise<string> {
  const { File, FileMode, Paths } = await import("expo-file-system");
  const source = new File(uri);
  // The camera can hand back the file a moment before it has finished writing: wait until its size stops changing.
  let size = -1, steady = 0;
  for (let i = 0; i < 30 && steady < 2; i += 1) {
    const now = source.exists ? source.size ?? 0 : 0;
    steady = now > 0 && now === size ? steady + 1 : 0;
    size = now;
    if (steady < 2) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (size <= 0) throw new Error("source " + (source.exists ? "empty" : "missing"));
  const target = new File(Paths.document, `linqa-capture-${Date.now()}-${Math.random().toString(16).slice(2)}.${suffix}`);
  target.create({ overwrite: true });
  const reader = source.open(FileMode.ReadOnly), writer = target.open(FileMode.Append);
  try {
    for (let offset = 0; offset < size; offset += COPY_CHUNK) {
      reader.offset = offset;
      writer.writeBytes(reader.readBytes(Math.min(COPY_CHUNK, size - offset)));
    }
  } finally { reader.close(); writer.close(); }
  const kept = new File(target.uri);
  if (!kept.exists || (kept.size ?? 0) !== size) { try { if (kept.exists) kept.delete(); } catch { /* nothing more to do */ } throw new Error("copy incomplete"); }
  try { source.delete(); } catch { /* the cache copy may already be gone */ }
  return kept.uri;
}
const COPY_CHUNK = 1024 * 1024;
const NOT_READY = "One of the people you chose has not opened Linqa recently, so their phone cannot receive this yet. Ask them to open the app, or choose someone else. Nothing was posted.";
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
  const [recording, setRecording] = useState(false);
  // These describe what this feature actually does (see docs/LIVE_VIDEO_PODCAST.md): client-side encryption, and nothing visible
  // to anyone until the recording is posted. They do not claim a particular messaging protocol suite.
  const badges = [
    { icon: "lock-closed", label: "End-to-end encrypted" },
    { icon: "eye-off-outline", label: "Private until you post" }
  ] as const;
  return (
    <SafeAreaView style={s.screen}>
      {recording ? null : (
        <>
          <View style={s.topRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }}><Ionicons name="arrow-back" size={24} color={INK} /></Pressable>
            <Text accessibilityRole="header" style={[s.title, { marginLeft: 8 }]}>Video podcast</Text>
          </View>
          <View style={s.topStrip}>
            {badges.map((badge, i) => (
              <React.Fragment key={badge.label}>
                {i > 0 ? <View style={s.badgeSep} /> : null}
                <View style={s.badge}><Ionicons name={badge.icon} size={16} color="#4ADE80" /><Text style={s.badgeText}>{badge.label}</Text></View>
              </React.Fragment>
            ))}
          </View>
          <View style={s.tabs}>
            <View style={s.tabPill}>
              {(["record", "watch"] as const).map((value) => (
                <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={[s.tab, tab === value && s.tabOn]}>
                  <Text style={[s.tabText, tab === value && { color: "#FFFFFF" }]}>{value === "record" ? "Record" : "Watch"}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </>
      )}
      {tab === "record" ? <RecordTab onRecording={setRecording} /> : <WatchTab />}
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

function RecordTab({ onRecording }: { onRecording: (recording: boolean) => void }) {
  const router = useRouter();
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
  const [facing, setFacing] = useState<"front" | "back">("front");
  const [muted, setMuted] = useState(false);
  const [torch, setTorch] = useState(false);
  const [limitMin, setLimitMin] = useState<(typeof DURATIONS)[number]>(30);
  const [sheet, setSheet] = useState(false);
  const cancel = useRef({ aborted: false });
  useEffect(() => { onRecording(recording); return () => onRecording(false); }, [recording, onRecording]);
  const [saved, setSaved] = useState<{ vault?: boolean; phone?: boolean }>({});
  const [saving, setSaving] = useState<"vault" | "phone" | null>(null);
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
    if ((!clip && !sheet) || contacts) return;
    const hub = new MobileHubService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
    hub.loadHub().then((snapshot) => setContacts(snapshot.contacts), () => setContacts([]));
  }, [clip, sheet, contacts]);

  useEffect(() => { sweepSecureScratch(); }, []); // leftovers from a run that was killed mid-upload or mid-playback

  async function record() {
    if (!camera.current || !ready || recording) return;
    setMessage(null);
    if (!micPermission?.granted) { const granted = await requestMic(); if (!granted.granted) { setMessage({ text: "Allow microphone access to record a podcast.", ok: false }); return; } }
    setRecording(true);
    const startedAt = Date.now();
    try {
      const result = await camera.current.recordAsync({ maxDuration: limitMin * 60 });
      if (!result?.uri) throw new Error("empty");
      const mov = /\.mov$/i.test(result.uri);
      const kept = await keepRecording(result.uri, mov ? "mov" : "mp4");
      setClip({ uri: kept, mime: mov ? "video/quicktime" : "video/mp4", seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)) });
      setSheet(false);
    } catch {
      setMessage({ text: "The recording was not saved. Try again.", ok: false });
    } finally {
      setRecording(false);
    }
  }

  async function discard() {
    if (clip) await discardLocalMedia(clip.uri);
    setClip(null); setChosen(new Set()); setMessage(null); setSaved({});
  }

  /** Encrypts the recording on this phone and stores it in LinqaVault. It does not need anyone to share it with. */
  async function toVault() {
    if (!clip || !selfId || saving || posting) return;
    setSaving("vault"); setMessage(null);
    try {
      const { File } = await import("expo-file-system");
      const file = new File(clip.uri);
      if (!file.exists || (file.size ?? 0) <= 0) throw new VaultSaveError("The recording is empty. Record it again.");
      if ((file.size ?? 0) > VAULT_MAX_BYTES) throw new VaultSaveError("This recording is over the vault's 25 MB limit. Record a shorter one (about 2 minutes), or save it to your phone.");
      await saveToVault({ accountId: selfId, plainBase64: await file.base64(), details: { name: `Podcast ${new Date().toISOString().slice(0, 16).replace("T", " ")}.${clip.mime === "video/quicktime" ? "mov" : "mp4"}`, mimeType: clip.mime, kind: "VIDEO" } });
      setSaved((c) => ({ ...c, vault: true }));
      setMessage({ text: "Encrypted on this phone and saved to LinqaVault.", ok: true });
    } catch (e) {
      setMessage({ text: e instanceof VaultSaveError ? e.message : "The vault could not save this. Try again.", ok: false });
    } finally { setSaving(null); }
  }

  /** A plain (unencrypted) copy in the phone's gallery, for people who want one. */
  async function toPhone() {
    if (!clip || saving || posting) return;
    setSaving("phone"); setMessage(null);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) throw new Error("denied");
      await MediaLibrary.saveToLibraryAsync(clip.uri);
      setSaved((c) => ({ ...c, phone: true }));
      setMessage({ text: "Saved to your gallery. That copy is not encrypted.", ok: true });
    } catch {
      try {
        if (!(await Sharing.isAvailableAsync())) throw new Error("none");
        await Sharing.shareAsync(clip.uri, { mimeType: clip.mime, dialogTitle: "Save to your phone" });
        setSaved((c) => ({ ...c, phone: true }));
      } catch { setMessage({ text: "This could not be saved to the phone. Allow storage access and try again.", ok: false }); }
    } finally { setSaving(null); }
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
      setMessage({ text: e instanceof StatusVideoPostError ? POST_ERRORS[e.code] : /RECIPIENT_(NOT_READY|UNKNOWN)/.test(String((e as Error)?.message ?? e)) ? NOT_READY : "Something went wrong. Nothing was posted.", ok: e instanceof StatusVideoPostError && e.code === "CANCELLED" ? true : false });
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
        {storageReady === false ? <Text accessibilityRole="alert" style={[s.message, { color: "#FDB022" }]}>Sharing videos is not available on this server yet, so this can't be posted. Your recording stays on this phone until you leave this screen.</Text> : null}
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
            <View style={s.saveRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="Save to LinqaVault, encrypted on this phone" disabled={saving !== null} onPress={() => void toVault()} style={[s.saveBtn, saving !== null && { opacity: 0.6 }]}>
                {saving === "vault" ? <ActivityIndicator color={PURPLE} /> : <Ionicons name={saved.vault ? "checkmark-circle" : "lock-closed-outline"} size={18} color={saved.vault ? "#4ADE80" : INK} />}
                <View style={{ flex: 1 }}><Text style={s.saveTitle}>{saved.vault ? "Saved to Vault" : "Save to Vault"}</Text><Text style={s.saveSub}>Encrypted</Text></View>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Save a copy to your phone" disabled={saving !== null} onPress={() => void toPhone()} style={[s.saveBtn, saving !== null && { opacity: 0.6 }]}>
                {saving === "phone" ? <ActivityIndicator color={PURPLE} /> : <Ionicons name={saved.phone ? "checkmark-circle" : "download-outline"} size={18} color={saved.phone ? "#4ADE80" : INK} />}
                <View style={{ flex: 1 }}><Text style={s.saveTitle}>{saved.phone ? "Saved" : "Save to phone"}</Text><Text style={s.saveSub}>Not encrypted</Text></View>
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" onPress={() => void discard()} style={s.ghost}><Text style={s.ghostText}>Discard and record again</Text></Pressable>
          </>
        )}
        {message ? <Text accessibilityRole="alert" style={[s.message, { color: message.ok ? "#4ADE80" : "#F97066" }]}>{message.text}</Text> : null}
      </View>
    );
  }

  const toggle = (id: string) => setChosen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const picked = (contacts ?? []).filter((c) => chosen.has(c.id));
  const flip = () => { setFacing((f) => (f === "front" ? "back" : "front")); setTorch(false); };

  return (
    <View style={{ flex: 1 }}>
      <View style={s.cameraFrame}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} mute={muted} enableTorch={torch && facing === "back"} mode="video" videoQuality="720p" videoBitrate={VIDEO_BITRATE} onCameraReady={() => setReady(true)} />

        {recording ? (
          <>
            <View style={s.chipRow}>
              <View style={s.chip}><Ionicons name="lock-closed" size={14} color="#F97066" /><Text style={s.chipText}>End-to-end encrypted</Text></View>
              <View style={[s.chip, { flexShrink: 1 }]}><Ionicons name="eye-off-outline" size={14} color="#4ADE80" /><Text style={s.chipText} numberOfLines={1}>No one can see this recording</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="What is protected" hitSlop={6} style={s.chipBtn}
                onPress={() => Alert.alert("What is protected", "This recording is encrypted on your phone. Nothing leaves it until you post, and then only the people you choose can open it.")}>
                <Ionicons name="shield-checkmark-outline" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
            <View style={s.recBlock} accessibilityLiveRegion="polite" accessibilityLabel={`Recording, ${clockHms(elapsed)} elapsed`}>
              <View style={s.recRow}><View style={s.recDot} /><Text style={s.recLabel}>REC</Text></View>
              <Text style={s.recClock}>{clockHms(elapsed)}</Text>
            </View>
          </>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={`Session length ${limitMin} minutes. Tap to change.`}
            onPress={() => setLimitMin((m) => DURATIONS[(DURATIONS.indexOf(m) + 1) % DURATIONS.length]!)} style={s.limitChip}>
            <Ionicons name="time-outline" size={18} color="#FFFFFF" /><Text style={s.limitText}>{limitMin} min</Text>
          </Pressable>
        )}

        <Pressable accessibilityRole="button" accessibilityLabel={`Invite guests. ${chosen.size} selected.`} onPress={() => setSheet(true)} style={[s.inviteChip, { bottom: recording ? 170 : 130 }]}>
          <View style={s.inviteIcon}><Ionicons name="person-add" size={18} color="#FFFFFF" /></View>
          <Text style={s.inviteChipText}>Invite Guest{chosen.size > 0 ? ` (${chosen.size})` : ""}</Text>
          <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
        </Pressable>

        {recording ? (
          <View style={s.panel}>
            <Pressable accessibilityRole="button" accessibilityLabel={muted ? "Unmute microphone" : "Mute microphone"} accessibilityState={{ disabled: true }} disabled style={[s.panelBtn, { opacity: 0.5 }]}>
              <View style={s.circle}><Ionicons name={muted ? "volume-mute" : "mic"} size={26} color="#FFFFFF" /></View>
              <Text style={s.panelLabel}>{muted ? "Muted" : "Mute"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Stop recording" onPress={() => camera.current?.stopRecording()} style={s.stopRing}>
              <View style={s.stopSquare} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Flip camera" accessibilityState={{ disabled: true }} disabled style={[s.panelBtn, { opacity: 0.5 }]}>
              <View style={s.circle}><Ionicons name="sync" size={26} color="#FFFFFF" /></View>
              <Text style={s.panelLabel}>Flip</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.idleControls}>
            <Pressable accessibilityRole="button" accessibilityLabel="Flip camera" onPress={flip} style={s.squareBtn}><Ionicons name="camera-reverse-outline" size={28} color="#FFFFFF" /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Start recording" disabled={!ready} onPress={() => void record()} style={[s.shutter, !ready && { opacity: 0.5 }]}>
              <View style={s.shutterInner} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={muted ? "Unmute microphone" : "Mute microphone"} accessibilityState={{ selected: muted }} onPress={() => setMuted((v) => !v)} style={s.squareBtn}>
              <Ionicons name={muted ? "mic-off" : "mic"} size={28} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
      </View>
      {message ? <Text accessibilityRole="alert" style={[s.message, { color: message.ok ? "#4ADE80" : "#F97066", textAlign: "center" }]}>{message.text}</Text> : null}
      <InviteSheet visible={sheet} contacts={contacts} chosen={chosen} selected={picked} onToggle={toggle} onClear={() => setChosen(new Set())}
        limitMin={limitMin} onLimit={setLimitMin} recording={recording} facing={facing} onFlip={flip} torch={torch} onTorch={() => setTorch((v) => !v)}
        onAddPerson={() => { setSheet(false); router.push("/connections"); }}
        onClose={() => setSheet(false)} onStart={() => { setSheet(false); void record(); }} />
    </View>
  );
}

/**
 * Go Live sheet. The people chosen here are the audience of the post made after recording; nobody joins the recording and no
 * invitation message is sent, so the copy says who can watch rather than who is invited.
 */
function InviteSheet(props: {
  visible: boolean; contacts: HubContact[] | null; chosen: Set<string>; selected: HubContact[]; recording: boolean;
  limitMin: number; onLimit: (m: (typeof DURATIONS)[number]) => void; facing: "front" | "back"; onFlip: () => void;
  torch: boolean; onTorch: () => void; onAddPerson: () => void;
  onToggle: (id: string) => void; onClear: () => void; onClose: () => void; onStart: () => void;
}) {
  const rest = (props.contacts ?? []).filter((c) => !props.chosen.has(c.id));
  const row = (c: HubContact, on: boolean) => (
    <Pressable key={c.id} accessibilityRole="checkbox" accessibilityLabel={c.displayName} accessibilityState={{ checked: on }} onPress={() => props.onToggle(c.id)} style={s.sheetRow}>
      <View style={[s.avatar, { backgroundColor: `hsl(${c.colorHue}, 55%, 42%)` }]}><Text style={s.avatarText}>{c.initials || c.displayName.trim().charAt(0).toUpperCase()}</Text></View>
      <Text style={[s.rowText, { flex: 1 }]} numberOfLines={1}>{c.displayName}</Text>
      <Ionicons name={on ? "checkmark-circle-outline" : "ellipse-outline"} size={24} color={on ? "#4ADE80" : MUTED} />
    </Pressable>
  );
  return (
    <Modal visible={props.visible} transparent animationType="slide" statusBarTranslucent onRequestClose={props.onClose}>
      <View style={{ flex: 1, backgroundColor: "#0B0B0F" }}>
        <View style={s.goTop}>
          <View style={s.goHead}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={props.onClose} style={s.goRound}><Ionicons name="close" size={26} color="#FFFFFF" /></Pressable>
            <View style={{ alignItems: "center", flex: 1 }}>
              <Text accessibilityRole="header" style={s.goTitle}>Go Live</Text>
              <Text style={s.goSub}>Choose who can watch your podcast</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Flip camera" accessibilityState={{ disabled: props.recording }} disabled={props.recording} onPress={props.onFlip} style={[s.goRound, props.recording && { opacity: 0.4 }]}><Ionicons name="sync" size={24} color="#FFFFFF" /></Pressable>
          </View>
          <View style={s.goBar}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Camera: ${props.facing}. Tap to switch.`} disabled={props.recording} onPress={props.onFlip} style={s.goCam}>
              <Ionicons name="camera" size={22} color="#FFFFFF" /><Text style={s.goCamText}>Camera</Text><Ionicons name="chevron-down" size={16} color="#FFFFFF" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={props.torch ? "Turn flash off" : "Turn flash on"} accessibilityState={{ selected: props.torch, disabled: props.facing !== "back" }} disabled={props.facing !== "back"} onPress={props.onTorch}
              style={[s.goBolt, props.facing !== "back" && { opacity: 0.4 }]}><Ionicons name={props.torch ? "flash" : "flash-outline"} size={20} color="#FFFFFF" /></Pressable>
          </View>
        </View>
        <View style={s.sheet}>
          <View style={s.grabber} />
          <View style={s.sheetHead}>
            <View style={{ flex: 1, alignItems: "center", marginLeft: 48 }}>
              <Text accessibilityRole="header" style={s.sheetTitle}>Invite Guests</Text>
              <Text style={s.meta}>Selected guests can watch after you post</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Find people to add" accessibilityState={{ disabled: props.recording }} disabled={props.recording} onPress={props.onAddPerson} style={[s.addBtn, props.recording && { opacity: 0.4 }]}><Ionicons name="person-add-outline" size={22} color="#FFFFFF" /></Pressable>
          </View>
          <ScrollView style={{ flex: 1, minHeight: 90 }}>
            {props.contacts === null ? <ActivityIndicator color={BLUE} /> : props.contacts.length === 0 ? <Text style={s.hint}>You have no contacts to share with yet.</Text> : (
              <>
                {props.selected.length > 0 ? (
                  <View style={s.selectedBox}>
                    <View style={s.selectedHead}>
                      <Text style={s.selectedTitle}>Selected ({props.selected.length})</Text>
                      <Pressable accessibilityRole="button" onPress={props.onClear} hitSlop={8}><Text style={s.clear}>Clear all</Text></Pressable>
                    </View>
                    {props.selected.map((c) => row(c, true))}
                  </View>
                ) : null}
                {rest.map((c) => row(c, false))}
              </>
            )}
          </ScrollView>
          <View style={s.lockNote}><Ionicons name="lock-closed" size={15} color={MUTED} /><Text style={s.meta}><Text style={{ color: INK, fontWeight: "700" }}>Only</Text> chosen people can watch after the podcast is posted.</Text></View>
          <View style={s.divider} />
          <Text style={s.sheetTitle2}>Live Duration</Text>
          <Text style={s.meta}>Choose how long your recording can last</Text>
          <View style={s.durRow}>
            {DURATIONS.map((m) => (
              <Pressable key={m} accessibilityRole="radio" accessibilityLabel={`${m} minutes`} accessibilityState={{ selected: props.limitMin === m, disabled: props.recording }} disabled={props.recording}
                onPress={() => props.onLimit(m)} style={[s.durBtn, props.limitMin === m && s.durOn, props.recording && { opacity: 0.4 }]}>
                <Text style={s.durText}>{m} min</Text>
              </Pressable>
            ))}
            <View accessible accessibilityRole="radio" accessibilityState={{ disabled: true }} accessibilityLabel="60 minutes. Sessions over 30 minutes will carry a fee and are not available yet." style={[s.durBtn, { opacity: 0.45 }]}>
              <Text style={s.durText}>60 min</Text><Text style={s.feeTag}>Fee</Text>
            </View>
          </View>
          <Text style={[s.meta, { marginTop: 6 }]}>Sessions over 30 min will carry a fee. Not available yet.</Text>
          <Pressable accessibilityRole="button" onPress={props.recording ? props.onClose : props.onStart} style={s.startBtn}>
            <Ionicons name={props.recording ? "checkmark" : "radio"} size={24} color="#FFFFFF" />
            <Text style={s.startText}>{props.recording ? "Done" : "Start Live"}</Text>
          </Pressable>
          <View style={[s.lockNote, { justifyContent: "center" }]}><Ionicons name="lock-closed" size={15} color={MUTED} /><Text style={s.meta}>Private. Only people you choose can watch.</Text></View>
        </View>
      </View>
    </Modal>
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
      {failed ? <Text accessibilityRole="alert" style={[s.message, { color: "#F97066" }]}>Could not refresh. Pull down to try again.</Text> : null}
      {message ? <Text accessibilityRole="alert" style={[s.message, { color: "#F97066" }]}>{message}</Text> : null}
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
            {busy === item.id ? <ActivityIndicator color="#F97066" /> : <Ionicons name="trash-outline" size={22} color="#F97066" />}
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
  screen: { flex: 1, backgroundColor: "#0B0B0F" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: "700", color: INK },
  tabs: { alignItems: "center", paddingHorizontal: 16, marginBottom: 10 },
  tabPill: { flexDirection: "row", backgroundColor: PANEL, borderRadius: 20, padding: 3, width: 220 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 34, borderRadius: 17 },
  tabOn: { backgroundColor: BLUE },
  tabText: { color: MUTED, fontWeight: "600", fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  cameraFrame: { flex: 1, borderRadius: 0, overflow: "hidden", backgroundColor: "#000" },
  chipRow: { position: "absolute", top: 12, left: 10, right: 10, flexDirection: "row", gap: 8, alignItems: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(15,16,22,0.78)", paddingHorizontal: 10, height: 34, borderRadius: 12 },
  chipText: { color: "#FFFFFF", fontSize: 11, fontWeight: "600" },
  chipBtn: { width: 34, height: 34, borderRadius: 12, backgroundColor: "rgba(15,16,22,0.78)", alignItems: "center", justifyContent: "center" },
  limitChip: { position: "absolute", bottom: 184, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(15,16,22,0.72)", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, minHeight: 36 },
  limitText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  recBlock: { position: "absolute", top: 62, alignSelf: "center", alignItems: "center" },
  recRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: REC },
  recLabel: { color: REC, fontSize: 22, fontWeight: "800" },
  recClock: { color: "#FFFFFF", fontSize: 30, fontWeight: "500", letterSpacing: 2, fontVariant: ["tabular-nums"] },
  inviteChip: { position: "absolute", left: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(15,16,22,0.82)", paddingLeft: 6, paddingRight: 12, paddingVertical: 6, borderRadius: 24, minHeight: 44 },
  inviteIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
  inviteChipText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  idleControls: { position: "absolute", left: 16, right: 16, bottom: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  squareBtn: { width: 48, height: 48, borderRadius: 14, backgroundColor: "rgba(15,16,22,0.78)", borderWidth: 1, borderColor: LINE, alignItems: "center", justifyContent: "center" },
  shutter: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#EF4444" },
  panel: { position: "absolute", left: 12, right: 12, bottom: 16, height: 96, borderRadius: 18, backgroundColor: "rgba(15,16,22,0.8)", borderWidth: 1, borderColor: LINE, flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  panelBtn: { alignItems: "center", gap: 4, minWidth: 64 },
  circle: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.5)", borderWidth: 1, borderColor: "#4B4E5C", alignItems: "center", justifyContent: "center" },
  panelLabel: { color: "#FFFFFF", fontSize: 12, fontWeight: "500" },
  stopRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: "#EF4444", alignItems: "center", justifyContent: "center" },
  stopSquare: { width: 24, height: 24, borderRadius: 6, backgroundColor: "#FFFFFF" },
  goTop: { height: 124, backgroundColor: "#0B0B0F", paddingTop: 30, paddingHorizontal: 16 },
  goHead: { flexDirection: "row", alignItems: "center" },
  goRound: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(40,40,48,0.85)", alignItems: "center", justifyContent: "center" },
  goTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  goSub: { color: "#C7CAD4", fontSize: 12 },
  goBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  goCam: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 38 },
  goCamText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  goBolt: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: "#6B6E7C", alignItems: "center", justifyContent: "center" },
  sheet: { flex: 1, backgroundColor: "#12131A", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 14, paddingBottom: 48 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#4B4E5C", marginVertical: 8 },
  sheetHead: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  sheetTitle: { color: INK, fontSize: 17, fontWeight: "700" },
  sheetTitle2: { color: INK, fontSize: 15, fontWeight: "700", marginTop: 2 },
  addBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: "#4B4E5C", alignItems: "center", justifyContent: "center" },
  selectedBox: { borderWidth: 1, borderColor: LINE, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 2, marginBottom: 6 },
  selectedHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  selectedTitle: { color: INK, fontSize: 14, fontWeight: "700" },
  clear: { color: "#A78BFA", fontWeight: "600", fontSize: 13 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  lockNote: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  divider: { height: 1, backgroundColor: LINE, marginVertical: 12 },
  durRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  durBtn: { flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: LINE, alignItems: "center", justifyContent: "center", backgroundColor: PANEL },
  durOn: { borderColor: "#7C6BFF", backgroundColor: "#2A2468" },
  durText: { color: "#FFFFFF", fontWeight: "600", fontSize: 13 },
  startBtn: { flexDirection: "row", gap: 10, minHeight: 46, borderRadius: 14, backgroundColor: "#4B2FA8", alignItems: "center", justifyContent: "center", marginTop: 12 },
  feeTag: { color: "#FBBF24", fontSize: 10, fontWeight: "700", marginTop: 1 },
  saveRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  saveBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: PANEL, paddingHorizontal: 10 },
  saveTitle: { color: INK, fontSize: 13, fontWeight: "700" },
  saveSub: { color: MUTED, fontSize: 11 },
  startText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  topStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 12, paddingVertical: 6 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  badgeText: { color: INK, fontSize: 12, fontWeight: "600" },
  badgeSep: { width: 1, height: 16, backgroundColor: LINE },
  topRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  previewBox: { height: 200, borderRadius: 16, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  section: { fontSize: 14, fontWeight: "800", color: INK, marginTop: 12, marginBottom: 6 },
  meta: { color: MUTED, fontSize: 12, lineHeight: 16, paddingHorizontal: 4 },
  hint: { color: MUTED, fontSize: 13, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: PANEL, marginBottom: 8, borderWidth: 1, borderColor: LINE },
  rowOn: { borderColor: PURPLE },
  rowText: { color: INK, fontSize: 14, fontWeight: "600" },
  primary: { minHeight: 44, borderRadius: 12, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, marginTop: 12 },
  primaryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  ghost: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  ghostText: { color: PURPLE, fontWeight: "700" },
  progress: { alignItems: "center", gap: 8, marginTop: 14 },
  message: { fontSize: 14, lineHeight: 20, marginTop: 10 },
  close: { position: "absolute", top: 48, right: 18, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }
});

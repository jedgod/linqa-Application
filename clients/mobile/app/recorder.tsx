import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAccounts } from "../account/AccountContext";
import { MediaPreview } from "../components/conversation/MediaPreview";
import { adoptCapture, discardLocalMedia } from "../services/conversation-media";
import { handOffImageToAssistant } from "../services/assistant.service";
import { saveToVault, VaultSaveError } from "../services/vault-save";

const PURPLE = "#5B4CFF";
const INK = "#0F172A";
const MUTED = "#64748B";
const MAX_VOICE_MS = 10 * 60_000;
const MAX_VIDEO_S = 120;

type Kind = "VOICE" | "PHOTO" | "VIDEO";
type Capture = { uri: string; kind: Kind; mimeType: string; name: string };

const clock = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/**
 * The home screen's Voice and Camera: record a voice clip, or take a photo or video, then choose where it goes: this phone, the
 * encrypted LinqaVault, or (for a photo) Linqa AI. Nothing is kept anywhere until one of those is chosen; Discard deletes it.
 */
export default function RecorderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { active } = useAccounts();
  const [mode, setMode] = useState<"voice" | "camera">(params.mode === "camera" ? "camera" : "voice");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [saved, setSaved] = useState<{ phone?: boolean; vault?: boolean }>({});

  const finish = useCallback((next: Capture | null) => { setCapture(next); setSaved({}); setMessage(null); }, []);

  async function discard() {
    if (capture) await discardLocalMedia(capture.uri).catch(() => undefined);
    finish(null);
  }
  useEffect(() => () => { /* a capture left on screen is removed when the screen closes */ }, []);

  async function toPhone() {
    if (!capture) return;
    setBusy("phone");
    setMessage(null);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (permission.granted) {
        await MediaLibrary.saveToLibraryAsync(capture.uri);
        setSaved((current) => ({ ...current, phone: true }));
        setMessage({ text: capture.kind === "VOICE" ? "Saved to your phone." : "Saved to your gallery.", ok: true });
      } else {
        throw new Error("denied");
      }
    } catch {
      // Audio (and a phone that refuses gallery access) falls back to the system share sheet, where "Save to Files" is offered.
      try {
        if (!(await Sharing.isAvailableAsync())) throw new Error("none");
        await Sharing.shareAsync(capture.uri, { mimeType: capture.mimeType, dialogTitle: "Save to your phone" });
        setSaved((current) => ({ ...current, phone: true }));
      } catch {
        setMessage({ text: "This could not be saved to the phone. Allow storage access and try again.", ok: false });
      }
    } finally {
      setBusy(null);
    }
  }

  async function toVault() {
    if (!capture || !active) return;
    setBusy("vault");
    setMessage(null);
    try {
      const { File } = await import("expo-file-system");
      const file = new File(capture.uri);
      if (!file.exists || (file.size ?? 0) <= 0) throw new VaultSaveError("The recording is empty. Record it again.");
      if ((file.size ?? 0) > 25 * 1024 * 1024) throw new VaultSaveError("This is too large for the vault (25 MB limit). Record a shorter one.");
      const plainBase64 = await file.base64();
      await saveToVault({ accountId: active.userId, plainBase64, details: { name: capture.name, mimeType: capture.mimeType, kind: capture.kind } });
      setSaved((current) => ({ ...current, vault: true }));
      setMessage({ text: "Encrypted on this phone and saved to LinqaVault.", ok: true });
    } catch (error) {
      setMessage({ text: error instanceof VaultSaveError ? error.message : "The vault could not save this. Try again.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function toAi() {
    if (!capture || capture.kind !== "PHOTO") return;
    setBusy("ai");
    try {
      const { File } = await import("expo-file-system");
      handOffImageToAssistant({ mimeType: "image/jpeg", dataBase64: await new File(capture.uri).base64() });
      router.push("/modules/ai");
    } catch {
      setMessage({ text: "The photo could not be opened for Linqa AI.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  const done = Boolean(saved.phone || saved.vault);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={24} color={INK} /></Pressable>
        <Text accessibilityRole="header" style={styles.title}>{capture ? "Review" : mode === "voice" ? "Voice recorder" : "Camera"}</Text>
        <View style={{ width: 24 }} />
      </View>

      {!capture ? (
        <View style={styles.tabs}>
          {(["voice", "camera"] as const).map((value) => (
            <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: mode === value }} onPress={() => setMode(value)} style={[styles.tab, mode === value && styles.tabActive]}>
              <Ionicons name={value === "voice" ? "mic-outline" : "camera-outline"} size={18} color={mode === value ? "#FFFFFF" : PURPLE} />
              <Text style={[styles.tabText, mode === value && { color: "#FFFFFF" }]}>{value === "voice" ? "Voice" : "Photo & video"}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {capture ? (
        <View style={styles.review}>
          <View style={styles.previewBox}><MediaPreview uri={capture.uri} kind={capture.kind === "VOICE" ? "VOICE" : capture.kind === "VIDEO" ? "VIDEO" : "PHOTO"} /></View>
          <Text style={styles.reviewTitle}>Where should this go?</Text>
          <ChoiceButton icon="phone-portrait-outline" label={saved.phone ? "Saved to phone" : "Save to phone"} detail="Your gallery or Files" busy={busy === "phone"} disabled={busy !== null} done={saved.phone} onPress={() => void toPhone()} />
          <ChoiceButton icon="lock-closed-outline" label={saved.vault ? "Saved to LinqaVault" : "Save to LinqaVault"} detail="Encrypted on this phone before upload" busy={busy === "vault"} disabled={busy !== null || !active} done={saved.vault} onPress={() => void toVault()} />
          {capture.kind === "PHOTO" ? <ChoiceButton icon="sparkles-outline" label="Ask Linqa AI about this photo" detail="Sent to the cloud AI only if you continue" busy={busy === "ai"} disabled={busy !== null} onPress={() => void toAi()} /> : null}
          {message ? <Text accessibilityRole="alert" style={[styles.message, { color: message.ok ? "#067647" : "#B42318" }]}>{message.text}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => void discard()} style={styles.discard}>
            <Text style={styles.discardText}>{done ? "Done, record another" : "Discard and record again"}</Text>
          </Pressable>
          {done ? <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.discard}><Text style={[styles.discardText, { color: PURPLE }]}>Close</Text></Pressable> : null}
        </View>
      ) : mode === "voice" ? (
        <VoiceRecorder onCaptured={finish} />
      ) : (
        <CameraRecorder onCaptured={finish} />
      )}
    </SafeAreaView>
  );
}

function ChoiceButton({ icon, label, detail, onPress, busy, disabled, done }: { icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; onPress: () => void; busy?: boolean; disabled?: boolean; done?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.choice, disabled && !busy && { opacity: 0.5 }]}>
      <View style={styles.choiceIcon}>{busy ? <ActivityIndicator color={PURPLE} /> : <Ionicons name={done ? "checkmark-circle" : icon} size={24} color={done ? "#16B874" : PURPLE} />}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.choiceLabel}>{label}</Text>
        <Text style={styles.choiceDetail}>{detail}</Text>
      </View>
    </Pressable>
  );
}

function VoiceRecorder({ onCaptured }: { onCaptured: (capture: Capture) => void }) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 96000 });
  const state = useAudioRecorderState(recorder, 200);
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stop = useCallback(async () => {
    if (!running.current) return;
    running.current = false;
    setBusy(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      const uri = recorder.uri;
      if (!uri) throw new Error("empty");
      const kept = await adoptCapture(uri, "m4a");
      onCaptured({ uri: kept, kind: "VOICE", mimeType: "audio/mp4", name: `voice-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.m4a` });
    } catch {
      setError("The recording was not saved. Try again.");
    } finally {
      setBusy(false);
    }
  }, [onCaptured, recorder]);

  const start = async () => {
    if (running.current || busy) return;
    setError(null);
    setBusy(true);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("Allow microphone access in phone settings to record.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      running.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording could not start.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { const sub = AppState.addEventListener("change", (value) => { if (value !== "active") void stop(); }); return () => sub.remove(); }, [stop]);
  useEffect(() => { if (state.isRecording && state.durationMillis >= MAX_VOICE_MS) void stop(); }, [state.durationMillis, state.isRecording, stop]);
  useEffect(() => () => { if (running.current) { running.current = false; void recorder.stop().catch(() => undefined); } }, [recorder]);

  return (
    <View style={styles.stage}>
      <Text accessibilityLiveRegion="polite" style={styles.timer}>{clock(state.isRecording ? state.durationMillis : 0)}</Text>
      <Text style={styles.hint}>{state.isRecording ? "Recording… tap to stop" : "Tap to start recording"}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={state.isRecording ? "Stop recording" : "Start recording"} disabled={busy} onPress={() => void (state.isRecording ? stop() : start())} style={[styles.bigButton, state.isRecording && { backgroundColor: "#D92D20" }]}>
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name={state.isRecording ? "stop" : "mic"} size={42} color="#FFFFFF" />}
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={[styles.message, { color: "#B42318" }]}>{error}</Text> : null}
    </View>
  );
}

function CameraRecorder({ onCaptured }: { onCaptured: (capture: Capture) => void }) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [video, setVideo] = useState(false);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => { if (permission && !permission.granted && permission.canAskAgain) void requestPermission(); }, [permission, requestPermission]);
  useEffect(() => {
    if (!recording) { setElapsed(0); return; }
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 250);
    return () => clearInterval(id);
  }, [recording]);

  async function shutter() {
    if (!camera.current || !ready || busy) return;
    setError(null);
    if (!video) {
      setBusy(true);
      try {
        const shot = await camera.current.takePictureAsync({ quality: 0.85 });
        const kept = await adoptCapture(shot.uri, "jpg");
        onCaptured({ uri: kept, kind: "PHOTO", mimeType: "image/jpeg", name: `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg` });
      } catch (e) {
        setError(e instanceof Error && e.message.startsWith("The capture") ? e.message : "The photo could not be taken. Try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (recording) { camera.current.stopRecording(); return; }
    if (!micPermission?.granted) { const granted = await requestMic(); if (!granted.granted) { setError("Allow microphone access to record video."); return; } }
    setRecording(true);
    try {
      const result = await camera.current.recordAsync({ maxDuration: MAX_VIDEO_S });
      if (!result?.uri) throw new Error("empty");
      const mov = /\.mov$/i.test(result.uri);
      const kept = await adoptCapture(result.uri, mov ? "mov" : "mp4");
      onCaptured({ uri: kept, kind: "VIDEO", mimeType: mov ? "video/quicktime" : "video/mp4", name: `video-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${mov ? "mov" : "mp4"}` });
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith("The capture") ? e.message : "The video was not saved. Try again.");
    } finally {
      setRecording(false);
    }
  }

  if (!permission?.granted) {
    return <View style={styles.stage}><Text style={styles.hint}>Allow camera access to take photos and videos.</Text><Pressable accessibilityRole="button" onPress={() => void requestPermission()} style={styles.permissionButton}><Text style={styles.permissionText}>Allow camera</Text></Pressable></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.cameraFrame}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} mode={video ? "video" : "picture"} onCameraReady={() => setReady(true)} />
        {recording ? <View style={styles.recPill}><View style={styles.recDot} /><Text style={styles.recText}>{clock(elapsed)}</Text></View> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={[styles.message, { color: "#B42318", textAlign: "center" }]}>{error}</Text> : null}
      <View style={styles.cameraControls}>
        <Pressable accessibilityRole="button" accessibilityLabel={video ? "Switch to photo" : "Switch to video"} disabled={recording} onPress={() => setVideo((value) => !value)} style={styles.sideButton}>
          <Ionicons name={video ? "camera-outline" : "videocam-outline"} size={24} color={PURPLE} />
          <Text style={styles.sideText}>{video ? "Photo" : "Video"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={video ? (recording ? "Stop recording" : "Start recording") : "Take photo"} disabled={!ready || busy} onPress={() => void shutter()} style={[styles.shutter, (!ready || busy) && { opacity: 0.5 }]}>
          <View style={[styles.shutterInner, video && { backgroundColor: "#D92D20" }, recording && { borderRadius: 8, width: 30, height: 30 }]} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Flip camera" disabled={recording} onPress={() => setFacing((value) => (value === "back" ? "front" : "back"))} style={styles.sideButton}>
          <Ionicons name="camera-reverse-outline" size={24} color={PURPLE} />
          <Text style={styles.sideText}>Flip</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6FC" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: INK, fontSize: 19, fontWeight: "700" },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  tab: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: "#D9DDF3", backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  tabActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  tabText: { color: PURPLE, fontSize: 15, fontWeight: "700" },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 },
  timer: { color: INK, fontSize: 56, fontWeight: "300", fontVariant: ["tabular-nums"] },
  hint: { color: MUTED, fontSize: 16, textAlign: "center" },
  bigButton: { width: 112, height: 112, borderRadius: 56, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
  message: { fontSize: 14, lineHeight: 20, paddingHorizontal: 16, paddingVertical: 6 },
  permissionButton: { minHeight: 48, paddingHorizontal: 24, borderRadius: 14, backgroundColor: PURPLE, alignItems: "center", justifyContent: "center" },
  permissionText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  cameraFrame: { flex: 1, margin: 12, borderRadius: 20, overflow: "hidden", backgroundColor: "#000" },
  recPill: { position: "absolute", top: 12, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#000A", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#F04438" },
  recText: { color: "#FFFFFF", fontWeight: "700" },
  cameraControls: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingVertical: 14 },
  sideButton: { width: 72, alignItems: "center", gap: 4 },
  sideText: { color: PURPLE, fontSize: 12, fontWeight: "600" },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: PURPLE, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: PURPLE },
  review: { flex: 1, paddingHorizontal: 16, gap: 10 },
  previewBox: { alignItems: "center", paddingVertical: 8 },
  reviewTitle: { color: INK, fontSize: 17, fontWeight: "700", marginTop: 4 },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E2E5F5", padding: 12, minHeight: 64 },
  choiceIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#EEF0FB", alignItems: "center", justifyContent: "center" },
  choiceLabel: { color: INK, fontSize: 16, fontWeight: "700" },
  choiceDetail: { color: MUTED, fontSize: 13, marginTop: 2 },
  discard: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  discardText: { color: MUTED, fontSize: 16, fontWeight: "600" }
});

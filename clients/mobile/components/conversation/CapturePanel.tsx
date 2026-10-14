import { withSystemUi } from "../../services/system-ui-guard";
import { PhotoCapture } from "./PhotoCapture";
import { VideoCapture } from "./VideoCapture";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Pressable, Text, View, ScrollView } from "react-native";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { assertMediaSignature, actualVideoDuration } from "../../services/media-validation";
import { MAX_MEDIA_BYTES, adoptCapture, discardLocalMedia } from "../../services/conversation-media";
import { validatePayload, type MediaPayload, type Theme } from "../../services/conversation-engine";
import { MediaPreview } from "./MediaPreview";
export type CaptureKind = "VOICE" | "VIDEO" | "GIF" | "PHOTO" | "DESIGN" | "GALLERY";
export function CapturePanel({ kind, theme: t, canSend, onSend, onClose, onAttach }: { kind: CaptureKind; theme: Theme; canSend: boolean; onSend: (p: MediaPayload) => Promise<boolean>; onClose: () => void; onAttach?: (p: MediaPayload) => void }) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, bitRate: 64000, numberOfChannels: 1 });
  const state = useAudioRecorderState(recorder, 200);
  const [draft, setDraft] = useState<MediaPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const busyRef = useRef(false);
  const tempUri = useRef<string | null>(null);
  const retained = useRef(false);
  const validating = useRef(false);
  const alive = useRef(true);
  const startedAt = useRef(0);
  const fail = (e: unknown) => { if (!alive.current) return; const message = e instanceof Error ? e.message : ""; setError(message.startsWith("Allow ") || message.startsWith("Choose ") || message.startsWith("Select ") || message === "The recording is empty." ? message : "Unable to capture this recording. Try again or check camera and microphone access."); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (tempUri.current && !retained.current) { void discardLocalMedia(tempUri.current) } }; }, []);
  const keep = async (p: MediaPayload) => {
    if (!alive.current) { if (p.localUri) void discardLocalMedia(p.localUri); return; }
    validatePayload(p);
    const file = new File(p.localUri!);
    tempUri.current = p.localUri!;
    if (!file.exists || !file.size) throw new Error("The recording is empty.");
    if (file.size > MAX_MEDIA_BYTES) throw new Error("Choose a shorter recording or a file under 25 MB.");
    const handle = file.open(); try { assertMediaSignature(handle.readBytes(Math.min(32, file.size)), p.mimeType); } finally { handle.close(); }
    validating.current = true; busyRef.current = true; setBusy(true);
    try {
      const durationMs = p.mediaKind === "VIDEO" ? await actualVideoDuration(p.localUri!) : p.durationMs;
      if (!alive.current) { void discardLocalMedia(p.localUri!); return; }
      setDraft({ ...p, ...(durationMs === undefined ? {} : { durationMs }) });
    } finally { validating.current = false; busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const stop = async () => {
    if (!running.current || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await recorder.stop(); running.current = false; await setAudioModeAsync({ allowsRecording: false }); if (recorder.uri) await keep({ type: "media", mediaId: Crypto.randomUUID(), mediaKind: "VOICE", mimeType: "audio/mp4", durationMs: Date.now() - startedAt.current, localUri: recorder.uri }); }
    catch (e) { running.current = false; fail(e); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => { const sub = AppState.addEventListener("change", value => { if (value !== "active" && running.current) void stop(); }); return () => sub.remove(); }, []);
  useEffect(() => { if (state.isRecording && state.durationMillis >= 60_000) void stop(); }, [state.durationMillis, state.isRecording]);
  const start = async () => {
    if (busyRef.current || running.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("Allow microphone access in phone settings to record a voice message.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(); recorder.record(); startedAt.current = Date.now(); running.current = true;
    } catch (e) { fail(e); await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const choose = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const result = await withSystemUi(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: kind === "GALLERY" ? ["images", "videos"] : ["images"], quality: kind === "GIF" ? 1 : 0.85, allowsEditing: kind === "DESIGN" }));
      if (result.canceled) return;
      const asset = result.assets[0];
      const video = asset.type === "video";
      if (video && (!asset.duration || asset.duration > 60_000)) throw new Error("Choose a video of 60 seconds or less.");
      const mime = asset.mimeType ?? (video ? /\.mov$/i.test(asset.uri) ? "video/quicktime" : "video/mp4" : /\.gif$/i.test(asset.uri) ? "image/gif" : "image/jpeg");
      if (kind === "GIF" && mime !== "image/gif") throw new Error("Select a GIF file from your phone.");
      // The picker leaves its copy in the app's cache folder, which Android clears on its own (the photo was gone by the
      // time it was sent). Keep our own copy straight away, as the camera paths do.
      const kept = await adoptCapture(asset.uri, video ? (mime === "video/quicktime" ? "mov" : "mp4") : "jpg");
      await keep({ type: "media", mediaId: Crypto.randomUUID(), mediaKind: video ? "VIDEO" : kind === "GIF" ? "GIF" : "PHOTO", mimeType: mime, ...(asset.duration ? { durationMs: asset.duration } : {}), localUri: kept });
    } catch (e) { fail(e); } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const send = async () => {
    if (!draft || !canSend || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { retained.current = true; const ok = await onSend(draft); if (ok) onClose(); else { setError("Couldn't send. Use Retry on the message in the conversation."); onClose(); } }
    catch (e) { retained.current = false; fail(e); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const close = async () => { if (busyRef.current) return; if (running.current) { await stop(); return; } onClose(); };
  const button = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress} style={{ padding: 14, borderRadius: 22, backgroundColor: disabled ? t.line : t.outgoing, marginTop: 12 }}><Text style={{ textAlign: "center", color: disabled ? t.muted : t.onOutgoing }}>{label}</Text></Pressable>;
  return <Modal transparent animationType="slide" onRequestClose={() => void close()}><View style={{ flex: 1, backgroundColor: "rgba(0,0,0,.4)", justifyContent: "flex-end" }}><View style={{ maxHeight: "90%", backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 44 }}><ScrollView keyboardShouldPersistTaps="handled"><Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "600", color: t.ink }}>{kind === "VOICE" ? "Voice recorder" : kind === "VIDEO" ? "Video recorder" : kind === "GIF" ? "Choose GIF" : kind === "DESIGN" ? "Edit photo" : kind === "GALLERY" ? "Choose from gallery" : "Take photo"}</Text>{draft ? <View style={{ alignItems: "center", marginTop: 18 }}><MediaPreview uri={draft.localUri!} kind={draft.mediaKind} /></View> : kind === "PHOTO" ? <PhotoCapture theme={t} onBusy={value => { busyRef.current = value || validating.current; setBusy(value || validating.current); }} onCaptured={uri => { void keep({ type: "media", mediaId: Crypto.randomUUID(), mediaKind: "PHOTO", mimeType: "image/jpeg", localUri: uri }).catch(fail); }} /> : kind === "VIDEO" ? <VideoCapture theme={t} onBusy={value => { busyRef.current = value || validating.current; setBusy(value || validating.current); }} onCaptured={(uri, durationMs) => { void keep({ type: "media", mediaId: Crypto.randomUUID(), mediaKind: "VIDEO", mimeType: /\.mov$/i.test(uri) ? "video/quicktime" : "video/mp4", durationMs, localUri: uri }).catch(fail); }} /> : kind === "VOICE" ? <><Text style={{ color: t.muted, marginTop: 16 }}>{state.isRecording ? "Recording · " + Math.floor(state.durationMillis / 1000) + "s" : "Record up to 60 seconds. Preview before sending."}</Text>{button(state.isRecording ? "Stop recording" : "Start recording", () => void (state.isRecording ? stop() : start()), busy)}</> : button("Open photo library", () => void choose(), busy)}{draft ? <>{onAttach ? button("Use attachment", () => { if (busyRef.current) return; retained.current = true; onAttach(draft); onClose(); }, busy) : button("Send", () => void send(), !canSend || busy)}{!canSend ? <Text style={{ color: t.warn, marginTop: 12 }}>Preview only. Secure sending is unavailable on this device.</Text> : null}</> : null}{busy ? <ActivityIndicator style={{ marginTop: 12 }} color={t.accent} /> : null}{error ? <Text accessibilityRole="alert" style={{ color: t.warn, marginTop: 12 }}>{error}</Text> : null}{button(draft ? "Discard" : "Cancel", () => void close(), busy)}</ScrollView></View></View></Modal>;
}

import React, { useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import type { Theme } from "../../services/conversation-engine";
import { adoptCapture, discardLocalMedia, MAX_MEDIA_BYTES } from "../../services/conversation-media";
export function VideoCapture({ theme: t, onCaptured, onBusy }: { theme: Theme; onCaptured: (uri: string, duration: number) => void; onBusy: (busy: boolean) => void }) {
 const camera = useRef<CameraView>(null);
 const [permission, requestCamera] = useCameraPermissions();
 const [microphone, requestMicrophone] = useMicrophonePermissions();
 const [ready, setReady] = useState(false);
 const [recording, setRecording] = useState(false);
 const [seconds, setSeconds] = useState(0);
 const [error, setError] = useState<string | null>(null);
 const [facing, setFacing] = useState<"back" | "front">("back");
 const running = useRef(false), alive = useRef(true), began = useRef(0);
 useEffect(() => { alive.current = true; const sub = AppState.addEventListener("change", value => { if (value !== "active" && running.current) camera.current?.stopRecording(); }); return () => { alive.current = false; if (running.current) camera.current?.stopRecording(); sub.remove(); }; }, []);
 useEffect(() => { if (!recording) return; const timer = setInterval(() => setSeconds(Math.floor((Date.now()-began.current)/1000)),200); return () => clearInterval(timer); }, [recording]);
 const authorize = async () => {
  try { setError(null); if (!permission?.granted) await requestCamera(); if (!microphone?.granted) await requestMicrophone(); } catch { setError("Unable to request camera or microphone access."); }
 };
 const record = async () => {
  if (!ready || !camera.current || running.current) return;
  running.current = true; began.current = Date.now(); setSeconds(0); setRecording(true); onBusy(true); setError(null);
  try {
   const result = await camera.current.recordAsync({ maxDuration: 60, maxFileSize: MAX_MEDIA_BYTES });
   if (result?.uri) { const kept = await adoptCapture(result.uri, /\.mov$/i.test(result.uri) ? "mov" : "mp4"); if (alive.current) onCaptured(kept,Math.min(60_000,Date.now()-began.current)); else void discardLocalMedia(kept); }
   else if (alive.current) setError("No video was saved. Try again.");
  } catch (e) { if (alive.current) setError(e instanceof Error && e.message.startsWith("The capture") ? e.message : "Unable to record video. Check permissions and try again."); }
  finally { running.current = false; if (alive.current) { setRecording(false); onBusy(false); } }
 };
 const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={action} style={{ padding: 14, marginTop: 10, borderRadius: 20, backgroundColor: disabled ? t.line : t.outgoing }}><Text style={{ color: disabled ? t.muted : t.onOutgoing, textAlign: "center" }}>{label}</Text></Pressable>;
 if (!permission?.granted || !microphone?.granted) return <View><Text style={{ color: t.muted, marginTop: 14 }}>Camera and microphone access are needed to record video.</Text>{button("Allow camera and microphone", () => void authorize())}{permission?.canAskAgain === false || microphone?.canAskAgain === false ? button("Open phone settings", () => void Linking.openSettings()) : null}</View>;
 return <View style={{ marginTop: 16 }}><CameraView ref={camera} mode="video" facing={facing} videoQuality="480p" videoBitrate={1_000_000} onCameraReady={() => setReady(true)} onMountError={() => { setReady(false); setError("Camera is unavailable. Close other camera apps and try again."); }} style={{ height: 280, borderRadius: 18, overflow: "hidden" }} />{button(recording ? "Stop video recording" : "Start video recording", () => { if (running.current) camera.current?.stopRecording(); else void record(); }, !ready)}{recording ? <Text style={{ color: t.warn, textAlign: "center", marginTop: 8 }}>Recording · {seconds}s</Text> : button("Flip camera", () => { setReady(false); setFacing(value => value === "back" ? "front" : "back"); })}{error ? <Text accessibilityRole="alert" style={{ color: t.warn, marginTop: 12 }}>{error}</Text> : null}</View>;
}

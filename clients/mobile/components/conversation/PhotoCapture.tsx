import React, { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { Theme } from "../../services/conversation-engine";
import { adoptCapture, discardLocalMedia } from "../../services/conversation-media";
export function PhotoCapture({ theme: t, onCaptured, onBusy }: { theme: Theme; onCaptured: (uri: string) => void; onBusy: (busy: boolean) => void }) {
  const camera = useRef<CameraView>(null), alive = useRef(true), pending = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false), [facing, setFacing] = useState<"back" | "front">("back");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function snap() {
    if (!ready || !camera.current || pending.current) return;
    pending.current = true; onBusy(true); setError(null);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.85 });
      if (photo?.uri) { const kept = await adoptCapture(photo.uri, "jpg"); if (alive.current) onCaptured(kept); else void discardLocalMedia(kept); }
      else if (alive.current) setError("No photo was saved. Please try again.");
    } catch (e) { if (alive.current) setError(e instanceof Error && e.message.startsWith("The capture") ? e.message : "Unable to take a photo. Please try again."); }
    finally { pending.current = false; if (alive.current) onBusy(false); }
  }
  const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{ minHeight: 48, marginTop: 10, borderRadius: 20, backgroundColor: disabled ? t.line : t.outgoing, justifyContent: "center" }}><Text style={{ color: t.onOutgoing, textAlign: "center" }}>{label}</Text></Pressable>;
  return <View style={{ marginTop: 16 }}>
    {permission?.granted ? <><CameraView ref={camera} mode="picture" facing={facing} onCameraReady={() => setReady(true)} onMountError={() => { setReady(false); setError("Camera is unavailable. Close other camera apps and try again."); }} style={{ height: 260, borderRadius: 18, overflow: "hidden" }} />{button("Take photo", () => void snap(), !ready || pending.current)}{button("Flip camera", () => { setReady(false); setFacing(v => v === "back" ? "front" : "back"); }, pending.current)}</> : <><Text style={{ color: t.muted }}>Allow camera access to take a photo.</Text>{button("Allow camera", () => { void requestPermission().catch(() => setError("Unable to request camera access.")); })}{permission?.canAskAgain === false ? button("Open phone settings", () => void Linking.openSettings()) : null}</>}
    {error ? <Text accessibilityRole="alert" style={{ color: t.warn, marginTop: 12 }}>{error}</Text> : null}
  </View>;
}

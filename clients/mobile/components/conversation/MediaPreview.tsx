import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
export function MediaPreview({ uri, kind, compact = false }: { compact?: boolean; uri: string; kind: "VOICE" | "VIDEO" | "GIF" | "PHOTO" }) {
  if (kind === "VOICE") return <AudioPreview uri={uri} />;
  if (kind === "VIDEO") return <VideoPreview uri={uri} compact={compact} />;
  return <Image source={{ uri }} resizeMode="contain" style={{ width: compact ? 90 : 230, height: compact ? 80 : 200, borderRadius: 14 }} />;
}
function AudioPreview({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? "Pause voice message" : "Play voice message"} onPress={() => { if (status.playing) player.pause(); else { if (status.didJustFinish) void player.seekTo(0); player.play(); } }} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14, backgroundColor: "#E2EEE8", borderRadius: 16 }}><Ionicons name={status.playing ? "pause" : "play"} color="#195D50" size={26} /><Text style={{ color: "#195D50" }}>Voice · {Math.floor(status.currentTime)} / {Math.floor(status.duration)}s</Text></Pressable>;
}
function VideoPreview({ uri, compact }: { uri: string; compact: boolean }) {
  const player = useVideoPlayer(uri);
  return <View style={{ width: compact ? 150 : 250, height: compact ? 110 : 240 }}><VideoView player={player} nativeControls contentFit="contain" style={{ flex: 1, borderRadius: 14 }} /></View>;
}

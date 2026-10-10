// Record and play voice messages with expo-audio. The waveform is built from
// metering samples while recording and sent inside the encrypted message.

import React, { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { PrepareInput } from "../../attachments/AttachmentService";
import { palette as c, space } from "../../ui/tokens";

const MAX_MS = 5 * 60_000;
const BARS = 48;

export function VoiceRecorder({ onSend, onCancel }: { onSend: (input: PrepareInput) => Promise<void>; onCancel: () => void }) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  const levels = useRef<number[]>([]);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Microphone is off", "Allow microphone access in Settings to record.", [{ text: "OK", onPress: onCancel }]);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    })();
    return () => {
      recorder.stop().catch(() => {});
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (state.isRecording && state.metering !== undefined) {
      // dBFS (-60..0) to 0..1
      levels.current.push(Math.max(0, Math.min(1, (state.metering + 60) / 60)));
    }
    if (state.durationMillis >= MAX_MS) finish();
  }, [state.durationMillis]);

  const togglePause = () => {
    if (paused) recorder.record();
    else recorder.pause();
    setPaused(!paused);
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri || state.durationMillis < 700) return onCancel();
      await onSend({ uri, name: "voice-message.m4a", mime: "audio/mp4", kind: "voice", durationMs: state.durationMillis, waveform: downsample(levels.current, BARS) });
    } finally {
      setBusy(false);
    }
  };

  const bars = downsample(levels.current, BARS);
  return (
    <View style={styles.rec}>
      <View style={styles.status}>
        <View style={[styles.dot, paused && { backgroundColor: c.muted }]} />
        <Text style={[styles.statusText, paused && { color: c.muted }]}>{paused ? "Paused" : "Recording"}</Text>
      </View>
      <Text style={styles.time} accessibilityLiveRegion="polite">
        {fmt(state.durationMillis)}
      </Text>
      <Waveform values={bars} progress={1} height={64} />
      <Text style={styles.hint}>Voice messages are encrypted on your phone. Up to 5 minutes.</Text>
      <View style={styles.controls}>
        <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Delete recording" style={styles.side}>
          <Text style={[styles.sideText, { color: c.danger }]}>Delete</Text>
        </Pressable>
        <Pressable onPress={togglePause} accessibilityRole="button" accessibilityLabel={paused ? "Resume" : "Pause"} style={styles.main}>
          <Text style={styles.mainText}>{paused ? "Resume" : "Pause"}</Text>
        </Pressable>
        <Pressable onPress={finish} disabled={busy} accessibilityRole="button" accessibilityLabel="Send voice message" style={[styles.side, styles.send]}>
          <Text style={[styles.sideText, { color: "#fff" }]}>{busy ? "…" : "Send"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function VoicePlayer({ path, durationMs, waveform, outgoing }: { path: string; durationMs?: number; waveform?: number[]; outgoing?: boolean }) {
  const player = useAudioPlayer(path);
  const status = useAudioPlayerStatus(player);
  const total = (status.duration || (durationMs ?? 0) / 1000) * 1000;
  const progress = total ? (status.currentTime * 1000) / total : 0;
  const [rate, setRate] = useState(1);

  const toggle = () => {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || progress >= 0.999) player.seekTo(0);
      player.play();
    }
  };
  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    player.setPlaybackRate(next);
  };

  return (
    <View style={styles.player}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={status.playing ? "Pause voice message" : "Play voice message"} style={styles.play}>
        <Text style={styles.playText}>{status.playing ? "❚❚" : "▶"}</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Waveform values={waveform ?? new Array(BARS).fill(0.3)} progress={progress} height={30} tint={outgoing ? "#C9DBE0" : undefined} />
      </View>
      <Text style={[styles.dur, outgoing && { color: "#C9DBE0" }]}>{fmt(status.playing ? status.currentTime * 1000 : total)}</Text>
      <Pressable onPress={cycleRate} accessibilityRole="button" accessibilityLabel={`Playback speed ${rate}x`} style={styles.rate}>
        <Text style={styles.rateText}>{rate}x</Text>
      </Pressable>
    </View>
  );
}

export function Waveform({ values, progress, height, tint }: { values: number[]; progress: number; height: number; tint?: string }) {
  return (
    <View style={[styles.wave, { height }]} accessibilityElementsHidden>
      {values.map((v, i) => (
        <View key={i} style={{ flex: 1, height: Math.max(3, v * height), borderRadius: 2, backgroundColor: i / values.length <= progress ? c.secure : tint ?? "#B5C0CA" }} />
      ))}
    </View>
  );
}

export function downsample(values: number[], n: number): number[] {
  if (!values.length) return new Array(n).fill(0.05);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * values.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * values.length) / n));
    const slice = values.slice(a, b);
    out.push(Math.round((slice.reduce((s, x) => s + x, 0) / slice.length) * 100) / 100);
  }
  return out;
}

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const styles = StyleSheet.create({
  rec: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.xl, padding: space.xl, backgroundColor: c.surface },
  status: { flexDirection: "row", alignItems: "center", gap: space.s },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger },
  statusText: { color: c.danger, fontWeight: "600", fontSize: 14 },
  time: { fontSize: 56, fontWeight: "600", color: c.ink, fontVariant: ["tabular-nums"] },
  hint: { fontSize: 13, color: c.muted, textAlign: "center" },
  controls: { flexDirection: "row", alignItems: "center", gap: space.xl },
  side: { width: 72, height: 56, borderRadius: 28, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
  sideText: { fontWeight: "600", fontSize: 15 },
  send: { backgroundColor: c.secure },
  main: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: c.danger, alignItems: "center", justifyContent: "center" },
  mainText: { color: c.danger, fontWeight: "600" },
  wave: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "stretch" },
  player: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 230 },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.secure, alignItems: "center", justifyContent: "center" },
  playText: { color: "#fff", fontSize: 14 },
  dur: { fontSize: 12, color: c.muted, fontVariant: ["tabular-nums"] },
  rate: { minWidth: 36, height: 28, borderRadius: 14, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
  rateText: { fontSize: 12, fontWeight: "600", color: c.ink },
});

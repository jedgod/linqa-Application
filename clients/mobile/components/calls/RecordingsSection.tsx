import React, { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { deleteRecording, formatDuration, loadRecordings, mergedLines, type CallRecording } from "../../services/call-recordings";

const COLORS = { surface: "#07142C", border: "#203357", text: "#F7F9FF", muted: "#A6B4DC", blue: "#068BFF", red: "#FF5B67" };

/** Recordings made during calls (with the other person's permission), each with a playable audio file and a transcript. */
export function RecordingsSection() {
  const [items, setItems] = useState<CallRecording[]>([]);
  const refresh = useCallback(() => { void loadRecordings().then(setItems); }, []);
  useFocusEffect(refresh);

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>Recordings</Text>
      {items.length === 0 ? (
        <Text style={styles.empty}>No recordings yet. During a call, tap Record; the other person has to allow it.</Text>
      ) : (
        <View style={styles.list}>
          {items.map((item) => <RecordingRow key={item.id} item={item} onDeleted={refresh} />)}
        </View>
      )}
    </View>
  );
}

function RecordingRow({ item, onDeleted }: { item: CallRecording; onDeleted: () => void }) {
  const player = useAudioPlayer(item.audioUri);
  const status = useAudioPlayerStatus(player);
  const [open, setOpen] = useState(false);
  const lines = mergedLines(item.lines);
  const when = new Date(item.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const toggle = () => {
    if (status.playing) player.pause();
    else { if (status.didJustFinish) void player.seekTo(0); player.play(); }
  };
  const remove = () => Alert.alert("Delete recording?", "The audio and its transcript are removed from this phone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { player.pause(); void deleteRecording(item.id).then(onDeleted); } }
  ]);

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? "Pause recording" : "Play recording"} onPress={toggle} style={styles.play}>
          <Ionicons name={status.playing ? "pause" : "play"} size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.meta}>
          <Text style={styles.name}>{item.peerName || "Call"} · {item.callType === "VIDEO" ? "video" : "voice"}</Text>
          <Text style={styles.sub}>{when} · {formatDuration(item.durationMs)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Delete recording" onPress={remove} hitSlop={10}>
          <Ionicons name="trash-outline" size={20} color={COLORS.red} />
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)} style={styles.toggle}>
        <Text style={styles.toggleText}>{open ? "Hide transcript" : lines.length ? `Show transcript (${lines.length} lines)` : "Transcript"}</Text>
      </Pressable>
      {open ? (
        lines.length ? (
          <View style={styles.transcript}>
            {lines.map((line, index) => (
              <Text key={`${line.atMs}-${index}`} style={styles.line}>
                <Text style={styles.stamp}>{formatDuration(line.atMs)} </Text>
                <Text style={[styles.who, line.who === "me" && { color: COLORS.blue }]}>{line.who === "me" ? "You" : item.peerName || "Them"}: </Text>
                {line.text}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={styles.empty}>No speech was recognised in this recording.</Text>
        )
      ) : null}
      <Text style={styles.footnote}>Audio is your side of the call only. The transcript includes both sides.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 15, paddingBottom: 84 },
  title: { color: COLORS.text, fontSize: 18, fontWeight: "700", marginTop: 22, marginBottom: 10 },
  empty: { color: COLORS.muted, fontSize: 14, lineHeight: 20 },
  list: { gap: 10 },
  row: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  play: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.blue, alignItems: "center", justifyContent: "center" },
  meta: { flex: 1 },
  name: { color: COLORS.text, fontSize: 16, fontWeight: "600" },
  sub: { color: COLORS.muted, fontSize: 13, marginTop: 2 },
  toggle: { minHeight: 32, justifyContent: "center" },
  toggleText: { color: COLORS.blue, fontSize: 14, fontWeight: "600" },
  transcript: { gap: 6 },
  line: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
  stamp: { color: COLORS.muted, fontSize: 12 },
  who: { color: "#05C9F6", fontWeight: "700" },
  footnote: { color: COLORS.muted, fontSize: 11 }
});

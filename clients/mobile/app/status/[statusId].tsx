import React, { useEffect, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";

const REACTIONS = ["❤️", "😂", "😮", "👏", "🔥"];

export default function StatusViewerScreen() {
  const { statusId } = useLocalSearchParams<{ statusId: string }>();
  const [progress, setProgress] = useState(0);
  const [reply, setReply] = useState("");

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((current) => Math.min(1, current + 0.02));
    }, 100);

    return () => clearInterval(timer);
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.progressTrack}>
        <View
          style={[styles.progressBar, { width: `${progress * 100}%` }]}
        />
      </View>

      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>AC</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>Avery Chen</Text>
          <Text style={styles.time}>12 minutes ago</Text>
        </View>
        <Pressable style={styles.iconButton}>
          <Ionicons name="volume-high-outline" size={20} color="#D6E4EC" />
        </Pressable>
        <Pressable style={styles.iconButton}>
          <Ionicons name="ellipsis-horizontal" size={20} color="#D6E4EC" />
        </Pressable>
      </View>

      <View style={styles.content}>
        <Text style={styles.statusText}>
          Finalizing the Linqa call experience today.
        </Text>
        <Text style={styles.statusId}>Status {statusId}</Text>
      </View>

      <View style={styles.reactions}>
        {REACTIONS.map((reaction) => (
          <Pressable key={reaction} style={styles.reaction}>
            <Text style={styles.reactionText}>{reaction}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.replyRow}>
        <TextInput
          value={reply}
          onChangeText={setReply}
          placeholder="Reply privately"
          placeholderTextColor="#758B9B"
          style={styles.replyInput}
        />
        <Pressable style={styles.sendButton}>
          <Ionicons name="send" size={19} color="#00212A" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#07192C", padding: 14 },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,.25)",
    overflow: "hidden",
  },
  progressBar: { height: 3, backgroundColor: "white" },
  header: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#6E43DE",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "white", fontWeight: "900" },
  name: { color: "white", fontWeight: "800" },
  time: { color: "#A1B3C0", fontSize: 11, marginTop: 2 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  statusText: {
    color: "white",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 39,
    textAlign: "center",
  },
  statusId: { color: "#8DA1B2", fontSize: 11, marginTop: 16 },
  reactions: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 14,
  },
  reaction: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  reactionText: { fontSize: 21 },
  replyRow: {
    flexDirection: "row",
    gap: 9,
    paddingBottom: 8,
  },
  replyInput: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,.12)",
    color: "white",
    paddingHorizontal: 16,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#12D6AE",
    alignItems: "center",
    justifyContent: "center",
  },
});

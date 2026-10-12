import React, { useRef } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { mediaLabel } from "../../services/conversation-media";
import { cardWhen } from "../../services/conversation-thread";
import type { ReplyRef, Theme } from "../../services/conversation-engine";
import type { TimelineItem } from "../../services/conversation-state";
import { radius, space, type } from "./theme";

/** What a reply quotes for a message: a short piece of text, or a label for media and cards. Nothing else about the message travels. */
export function replyPreview(item: TimelineItem): ReplyRef | null {
  const senderId = item.message.senderId;
  switch (item.kind) {
    case "text": return { id: item.message.id, senderId, text: item.payload.text.slice(0, 160) };
    case "media": return { id: item.message.id, senderId, text: (item.payload.caption ? `${mediaLabel(item.payload)}: ${item.payload.caption}` : mediaLabel(item.payload)).slice(0, 160) };
    case "card": return { id: item.message.id, senderId, text: `${item.payload.type === "meeting" ? "Meeting" : "Event"}: ${item.payload.title} · ${cardWhen(item.payload)}`.slice(0, 160) };
    case "share": return { id: item.message.id, senderId, text: `${item.payload.type === "location" ? "Location" : "Contact"}: ${item.payload.title}`.slice(0, 160) };
    default: return null;
  }
}

const REPLY_DISTANCE = 56;

/**
 * Drag a message sideways and let go to reply to it (the bubble springs back). Messages you received sit on the left and are dragged
 * to the right; messages you sent sit on the right and are dragged to the left. Vertical scrolling is left alone: the drag only
 * takes over when the finger moves clearly sideways.
 */
export function SwipeToReply({ enabled, direction, onReply, color, children }: { enabled: boolean; direction: "right" | "left"; onReply: () => void; color: string; children: React.ReactNode }) {
  const sign = direction === "right" ? 1 : -1;
  const x = useRef(new Animated.Value(0)).current;
  const reply = useRef(onReply);
  reply.current = onReply;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dx * sign > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderMove: (_e, g) => { x.setValue(sign * Math.max(0, Math.min(g.dx * sign, 90))); },
    onPanResponderRelease: (_e, g) => {
      if (g.dx * sign >= REPLY_DISTANCE) reply.current();
      Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    },
    onPanResponderTerminate: () => { Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(); }
  })).current;
  if (!enabled) return <>{children}</>;
  const opacity = x.interpolate(sign === 1 ? { inputRange: [0, 24, REPLY_DISTANCE], outputRange: [0, 0.4, 1], extrapolate: "clamp" } : { inputRange: [-REPLY_DISTANCE, -24, 0], outputRange: [1, 0.4, 0], extrapolate: "clamp" });
  return (
    <View>
      <Animated.View pointerEvents="none" style={[styles.hint, direction === "right" ? { left: 14 } : { right: 14 }, { opacity }]}><Ionicons name="arrow-undo" size={22} color={color} /></Animated.View>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>{children}</Animated.View>
    </View>
  );
}

/** The quoted message at the top of a reply bubble. */
export function QuotedReply({ reply, who, color, tint }: { reply: ReplyRef; who: string; color: string; tint: string }) {
  return (
    <View accessible accessibilityLabel={`Replying to ${who}: ${reply.text}`} style={[styles.quote, { backgroundColor: tint, borderLeftColor: color }]}>
      <Text style={[type.meta, { color, fontWeight: "700" }]} numberOfLines={1}>{who}</Text>
      <Text style={[type.meta, { color }]} numberOfLines={2}>{reply.text}</Text>
    </View>
  );
}

/** Above the message box while a reply is being written. */
export function ReplyBar({ reply, who, theme: t, onCancel }: { reply: ReplyRef; who: string; theme: Theme; onCancel: () => void }) {
  return (
    <View style={[styles.bar, { backgroundColor: t.surface, borderTopColor: t.line }]}>
      <View style={[styles.barQuote, { borderLeftColor: t.accent, backgroundColor: t.background }]}>
        <Text style={[type.meta, { color: t.accent, fontWeight: "700" }]} numberOfLines={1}>{`Replying to ${who}`}</Text>
        <Text style={[type.meta, { color: t.muted }]} numberOfLines={1}>{reply.text}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={onCancel} hitSlop={10} style={styles.cancel}><Ionicons name="close" size={22} color={t.muted} /></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { position: "absolute", top: 0, bottom: 0, justifyContent: "center" },
  quote: { borderLeftWidth: 3, borderRadius: 8, paddingHorizontal: space.s, paddingVertical: 4, marginBottom: 6 },
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.m, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  barQuote: { flex: 1, borderLeftWidth: 3, borderRadius: radius.control, paddingHorizontal: space.m, paddingVertical: 6 },
  cancel: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }
});

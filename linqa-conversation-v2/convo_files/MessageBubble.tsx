import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DisplayMessage } from "./types";
import { ConversationTheme, radius, space, type } from "./theme";

interface Props {
  message: DisplayMessage;
  theme: ConversationTheme;
  showMeta: boolean;
  onRetry?: (id: string) => void;
  onDiscard?: (id: string) => void;
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function BubbleImpl({ message: m, theme: t, showMeta, onRetry, onDiscard }: Props) {
  const out = m.outgoing;
  const tail = out
    ? { borderBottomRightRadius: showMeta ? radius.tail : radius.bubble }
    : { borderBottomLeftRadius: showMeta ? radius.tail : radius.bubble };

  let bubbleStyle;
  let content: React.ReactNode;
  let a11y: string;

  switch (m.body.state) {
    case "open":
      bubbleStyle = { backgroundColor: out ? t.outgoing : t.surface };
      content = (
        <Text style={[type.body, { color: out ? t.outgoingInk : t.ink }]} selectable>
          {m.body.text}
        </Text>
      );
      a11y = m.body.text;
      break;
    case "sealed":
      bubbleStyle = { borderWidth: 1.5, borderStyle: "dashed" as const, borderColor: t.sealed };
      content = <Text style={[type.body, styles.quiet, { color: t.sealed }]}>Encrypted message</Text>;
      a11y = "Encrypted message, can't be opened on this device";
      break;
    case "unreadable":
      bubbleStyle = {
        borderWidth: 1.5,
        borderStyle: "dashed" as const,
        borderColor: t.warn,
        backgroundColor: t.warnSurface,
      };
      content = <Text style={[type.body, styles.quiet, { color: t.warn }]}>Can't open this message</Text>;
      a11y = "Message couldn't be decrypted";
      break;
  }

  const failed = m.delivery === "failed";

  return (
    <View style={[styles.row, { alignItems: out ? "flex-end" : "flex-start" }]}>
      <View
        style={[styles.bubble, tail, bubbleStyle, failed && { opacity: 0.65 }]}
        accessible
        accessibilityLabel={`${out ? "You" : "Them"}: ${a11y}`}
      >
        {content}
      </View>

      {failed ? (
        <View style={styles.failRow}>
          <Text style={[type.meta, { color: t.warn }]}>Not sent. </Text>
          <Pressable onPress={() => onRetry?.(m.id)} accessibilityRole="button" hitSlop={8}>
            <Text style={[type.meta, styles.link, { color: t.warn }]}>Retry</Text>
          </Pressable>
          <Text style={[type.meta, { color: t.inkMuted }]}>  </Text>
          <Pressable onPress={() => onDiscard?.(m.id)} accessibilityRole="button" hitSlop={8}>
            <Text style={[type.meta, styles.link, { color: t.inkMuted }]}>Delete</Text>
          </Pressable>
        </View>
      ) : showMeta ? (
        <Text style={[type.meta, styles.meta, { color: t.inkMuted }]}>
          {m.delivery === "sending" ? "Sending" : timeLabel(m.sentAt)}
        </Text>
      ) : null}
    </View>
  );
}

export const MessageBubble = memo(BubbleImpl);

const styles = StyleSheet.create({
  row: { paddingHorizontal: space.m, marginTop: 2 },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: space.m + 2,
    paddingVertical: space.s + 1,
    borderRadius: radius.bubble,
  },
  quiet: { fontStyle: "italic" },
  meta: { marginTop: space.xs, marginBottom: space.s, marginHorizontal: space.xs },
  failRow: { flexDirection: "row", marginTop: space.xs, marginBottom: space.s },
  link: { fontWeight: "600", textDecorationLine: "underline" },
});

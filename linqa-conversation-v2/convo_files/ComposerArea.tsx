import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { GateState, LockReason } from "./types";
import { ConversationTheme, radius, space, type } from "./theme";

interface Props {
  gate: GateState;
  theme: ConversationTheme;
  peerFirstName: string;
  onSend: (text: string) => Promise<boolean>;
  onRecheck: () => void;
}

/** The bottom of the screen is the status. LIVE shows a composer; anything else explains why not. */
export function ComposerArea(props: Props) {
  return props.gate.mode === "LIVE" ? <Composer {...props} /> : <SealedStrip {...props} />;
}

function Composer({ theme: t, peerFirstName, onSend }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const canSend = text.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSend) return;
    const value = text;
    setText("");
    setBusy(true);
    const ok = await onSend(value);
    setBusy(false);
    // On failure the bubble shows Retry, so the draft is not restored here.
    void ok;
  };

  return (
    <View style={[styles.wrap, { backgroundColor: t.surface, borderTopColor: t.line }]}>
      <TextInput
        testID="composer-input"
        value={text}
        onChangeText={setText}
        placeholder={`Message ${peerFirstName}`}
        placeholderTextColor={t.inkMuted}
        multiline
        maxLength={4000}
        style={[type.body, styles.input, { color: t.ink, backgroundColor: t.bg }]}
        accessibilityLabel={`Message ${peerFirstName}`}
      />
      <Pressable
        testID="composer-send"
        onPress={submit}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !canSend }}
        style={[styles.send, { backgroundColor: canSend ? t.secure : t.line }]}
      >
        <Text style={[styles.sendText, { color: canSend ? "#FFFFFF" : t.inkMuted }]}>Send</Text>
      </Pressable>
    </View>
  );
}

const COPY: Record<LockReason | "CHECKING", { title: string; body: string; action?: string }> = {
  CHECKING: {
    title: "Checking encryption",
    body: "Messages stay sealed until this device confirms it can open them.",
  },
  SECURE_CORE_UNAVAILABLE: {
    title: "Messages are sealed on this device",
    body: "This version of the app can't open or send encrypted messages yet. Your history is safe and will open after an update.",
  },
  PROBE_FAILED: {
    title: "Encryption check failed",
    body: "Sending is off until the check passes.",
    action: "Check again",
  },
  NOT_READY: {
    title: "Secure messaging is still setting up",
    body: "This usually takes a moment.",
    action: "Check again",
  },
};

function SealedStrip({ gate, theme: t, onRecheck }: Props) {
  const key = gate.mode === "LOCKED" ? gate.reason : "CHECKING";
  const copy = COPY[key];
  const tone = key === "CHECKING" ? t.sealed : t.warn;

  return (
    <View
      testID="sealed-strip"
      accessibilityRole="summary"
      style={[styles.strip, { backgroundColor: t.surface, borderTopColor: tone }]}
    >
      <View style={styles.stripText}>
        <Text style={[type.body, { color: t.ink, fontWeight: "600" }]}>{copy.title}</Text>
        <Text style={[type.meta, { color: t.inkMuted, marginTop: 2 }]}>{copy.body}</Text>
      </View>
      {key === "CHECKING" ? (
        <ActivityIndicator color={tone} />
      ) : copy.action ? (
        <Pressable onPress={onRecheck} accessibilityRole="button" hitSlop={8} style={[styles.action, { borderColor: tone }]}>
          <Text style={[type.meta, { color: tone, fontWeight: "600" }]}>{copy.action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: radius.control,
    paddingHorizontal: space.l,
    paddingTop: space.s + 1,
    paddingBottom: space.s + 1,
    marginRight: space.s,
  },
  send: {
    height: 40,
    paddingHorizontal: space.l,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { fontSize: 15, fontWeight: "600" },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.l,
    paddingVertical: space.m,
    borderTopWidth: 3,
  },
  stripText: { flex: 1, marginRight: space.m },
  action: {
    borderWidth: 1.5,
    borderRadius: radius.control,
    paddingHorizontal: space.m,
    paddingVertical: space.s - 2,
  },
});

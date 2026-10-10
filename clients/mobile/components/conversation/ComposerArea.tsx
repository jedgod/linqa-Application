import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ComposerMenu, type ComposerAction } from "./ComposerMenu";
import { MAX_TEXT, type MediaPayload, type Theme } from "../../services/conversation-engine";
import { PhotoVideoToggle, type CaptureMode } from "./PhotoVideoToggle";
import { MediaPreview } from "./MediaPreview";
import { AttachmentChoices } from "./AttachmentChoices";
import type { GateState, LockReason } from "../../services/conversation-types";
import type { ThreadAction } from "../../services/conversation-thread";
import { radius, space, type } from "./theme";

interface Props {
  gate: GateState;
  theme: Theme;
  peerFirstName: string;
  onSend: (text: string) => Promise<boolean>;
  scopeKey: string;
  draft?: MediaPayload | null;
  onSendMedia?: (payload: MediaPayload) => Promise<boolean>;
  onRemoveMedia?: () => void;
  onRecheck: () => void;
  /** Opens the ✦ menu to the left of the message box. */
  onAdd?: () => void;
  onOpenAttachments?: () => void;
  onTools?: (action: ComposerAction) => void;
  onRecord?: (kind: "VOICE" | "VIDEO" | "PHOTO" | "GALLERY") => void;
  /** Document, AI image, Location, Contact, Poll, Event, Meeting and Live screen from the + menu. */
  onAction?: (action: ThreadAction) => void;
  /** Messaging is live and the chat is not blocked. */
  canUseActions?: boolean;
}

/** The bottom of the screen is the status. LIVE shows a composer; anything else explains why not. */
export function ComposerArea(props: Props) {
  return <>{props.gate.mode !== "LIVE" ? <SealedStrip {...props} onAdd={undefined} /> : null}<Composer {...props} /></>;
}

function Composer({ gate, theme: t, peerFirstName, onSend, onAdd, onOpenAttachments, onTools, onRecord, onAction, canUseActions, scopeKey, draft, onSendMedia, onRemoveMedia }: Props) {
  const input = useRef<TextInput>(null);
  const sending = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("video");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const generation = useRef(0);
  useEffect(() => { generation.current++; setText(""); setCaptureMode("video"); setMenuOpen(false); setAttachmentsOpen(false); }, [scopeKey]);
  useEffect(() => { generation.current++; setMenuOpen(false); setAttachmentsOpen(false); if (gate.mode === "LOCKED") setText(""); }, [gate.mode]);
  useEffect(() => () => { generation.current++; }, []);
  const live = gate.mode === "LIVE";
  const canSend = live && (!!draft || text.trim().length > 0) && !busy;

  const submit = async () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    const value = text.trim();
    const ticket = generation.current;
    setBusy(true);
    try {
      const ok = draft ? await onSendMedia?.({ ...draft, ...(value ? { caption: value } : {}) }) : await onSend(value);
      if (ok && ticket === generation.current) { setText(""); setSelection({ start: 0, end: 0 }); if (draft) onRemoveMedia?.(); }
    } catch { if (ticket === generation.current) Alert.alert("Not sent", "Please try again."); }
    finally { sending.current = false; setBusy(false); }
  };

  return (
    <>
    {draft?.localUri ? <View style={{ backgroundColor: t.surface, padding: 12, gap: 8 }}><MediaPreview compact uri={draft.localUri} kind={draft.mediaKind} /><Pressable accessibilityRole="button" accessibilityLabel="Remove attachment" disabled={busy} onPress={onRemoveMedia} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: t.ink }}>Remove attachment</Text></Pressable></View> : null}
    <View style={[styles.wrap, { backgroundColor: t.surface, borderTopColor: t.line }]}>
      <View style={[styles.inputWrap, { backgroundColor: t.background, borderColor: t.line }]}>
      <Pressable disabled={busy} onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Emoji and tools" style={styles.control}><Ionicons name="happy-outline" size={25} color={t.ink} /></Pressable>
<TextInput
        ref={input}
        testID="composer-input"
        editable={!busy}
        value={text}
        onChangeText={setText}
        onSelectionChange={event => setSelection(event.nativeEvent.selection)}
        selection={selection}
        placeholder={draft ? "Add a caption…" : `Message ${peerFirstName}`}
        placeholderTextColor={t.muted}
        multiline
        maxLength={MAX_TEXT}
        style={[type.body, styles.input, { color: t.ink }]}
        accessibilityLabel={`Message ${peerFirstName}`}
      / ></View>
      <Pressable testID="composer-add" disabled={busy} onPress={() => onOpenAttachments ? onOpenAttachments() : setAttachmentsOpen(true)} accessibilityRole="button" accessibilityLabel="Attachments" style={styles.control}><Ionicons name="add-circle-outline" size={27} color={t.ink} /></Pressable>
      {text.trim() || draft ? null : <PhotoVideoToggle mode={captureMode} onModeChange={setCaptureMode} onCapture={mode => onRecord?.(mode === "photo" ? "PHOTO" : "VIDEO")} disabled={busy} scopeKey={scopeKey + gate.mode} color={t.ink} surface={t.surface} ink={t.ink} />}
      {text.trim() || draft ? <Pressable
        testID="composer-send"
        onPress={submit}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !canSend }}
        style={[styles.send, { backgroundColor: canSend ? t.outgoing : t.line }]}
      >
        <Ionicons name="arrow-up" size={23} color={canSend ? t.onOutgoing : t.muted} />
      </Pressable> : <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Record voice" onPress={() => onRecord?.("VOICE")} style={styles.control}><Ionicons name="mic-outline" size={25} color={t.ink} /></Pressable>}
    </View>
    <ComposerMenu visible={menuOpen} theme={t} onClose={() => setMenuOpen(false)} onSticker={live && !busy ? emoji => { setMenuOpen(false); if (sending.current) return; sending.current = true; setBusy(true); const ticket = generation.current; void onSend(emoji).catch(() => { if (ticket === generation.current) Alert.alert("Not sent", "Please try again."); }).finally(() => { sending.current = false; if (ticket === generation.current) setBusy(false); }); } : undefined} onEmoji={emoji => { setText(value => (value.slice(0, selection.start) + emoji + value.slice(selection.end)).slice(0, MAX_TEXT)); const at = Math.min(selection.start + emoji.length, MAX_TEXT); setSelection({ start: at, end: at }); input.current?.focus(); }} onPick={action => { if (action === "Edit") { input.current?.focus(); } else onTools?.(action); }} />
    {attachmentsOpen ? <AttachmentChoices theme={t} peerFirstName={peerFirstName} canUse={canUseActions ?? live} onAction={onAction} onClose={() => setAttachmentsOpen(false)} onGallery={() => { setAttachmentsOpen(false); onRecord?.("GALLERY"); }} onMore={() => { setAttachmentsOpen(false); onAdd?.(); }} /> : null}
    </>
  );
}

const COPY: Record<LockReason | "CHECKING", { title: string; body: string; action?: string }> = {
  CHECKING: { title: "Checking encryption", body: "Messages stay sealed until this device confirms it can open them." },
  SECURE_CORE_UNAVAILABLE: {
    title: "Messages are sealed on this device",
    body: "This version of the app can't open or send encrypted messages yet. Your history is safe and will open after an update."
  },
  PROBE_FAILED: { title: "Encryption check failed", body: "Sending is off until the check passes.", action: "Check again" },
  NOT_READY: { title: "Secure messaging is still setting up", body: "This usually takes a moment.", action: "Check again" }
};

function SealedStrip({ gate, theme: t, onRecheck, onAdd }: Props) {
  const key = gate.mode === "LOCKED" ? gate.reason : "CHECKING";
  const copy = COPY[key];
  const tone = key === "CHECKING" ? t.sealed : t.warn;
  return (
    <Pressable testID="sealed-strip" accessibilityRole="button" accessibilityLabel="Encryption status" onPress={() => Alert.alert(copy.title, copy.body, [{ text: "OK" }, ...(copy.action ? [{ text: copy.action, onPress: onRecheck }] : [])])} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: t.surface }}>
      <Text style={[type.meta, { color: tone, textAlign: "center" }]}>{key === "CHECKING" ? "Checking encryption…" : "Secure sending unavailable on this device · Details"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  wrap: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: 10, paddingBottom: 32, gap: 6, borderTopWidth: StyleSheet.hairlineWidth },
  inputWrap: { flex: 1, flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: 25, minHeight: 46 },
  input: { flex: 1, maxHeight: 120, minHeight: 44, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10 },
  topic: { width: 29, height: 29, marginHorizontal: 8, borderWidth: 1.5, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  capture: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  add: { width: 32, height: 32, alignItems: "center", justifyContent: "center", marginRight: 2 },
  star: { fontSize: 24, lineHeight: 28 },
  send: { height: 40, paddingHorizontal: space.l, borderRadius: radius.control, alignItems: "center", justifyContent: "center" },
  sendText: { fontSize: 15, fontWeight: "600" },
  strip: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.l, paddingVertical: space.m, borderTopWidth: 3 },
  stripText: { flex: 1, marginRight: space.m },
  action: { borderWidth: 1.5, borderRadius: radius.control, paddingHorizontal: space.m, paddingVertical: space.s - 2 }
});

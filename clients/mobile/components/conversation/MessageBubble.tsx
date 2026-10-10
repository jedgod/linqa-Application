import React, { memo, useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { sharedAttachmentUrl } from "../../services/shared-attachment";
import { Ionicons } from "@expo/vector-icons";
import { File } from "expo-file-system";
import { MediaPreview } from "./MediaPreview";
import { mediaLabel } from "../../services/conversation-media";
import type { MediaPayload } from "../../services/conversation-engine";
import type { Theme } from "../../services/conversation-engine";
import { cardWhen } from "../../services/conversation-thread";
import type { TimelineItem } from "../../services/conversation-state";
import { radius, space, type } from "./theme";

interface Props {
  item: TimelineItem;
  theme: Theme;
  /** Votes are changed on the Decisions page, so a board here is a summary that opens it. */
  onOpenDecisions?: () => void;
  onRetry?: (id: string) => void;
  /** Try opening a message again; offered only when the failure may clear (for example a key not yet available). */
  onRetryOpen?: (id: string) => void;
  onDiscard?: (id: string) => void;
  onOpenMedia?: (p: MediaPayload) => Promise<string>;
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * One message: a rounded bubble with its time underneath. Mine are dark green on the right, theirs white on the left.
 * A message that can't be opened is an orange dashed bubble; one that failed to send has Retry and Delete beneath it.
 */
function BubbleImpl({ item, theme: t, onOpenDecisions, onRetry, onRetryOpen, onDiscard, onOpenMedia }: Props) {
  const m = item.message;
  const out = m.outgoing;
  const fg = out ? t.onOutgoing : t.ink;
  const align = out ? ("flex-end" as const) : ("flex-start" as const);
  let bubbleStyle: object;
  let content: React.ReactNode;
  let a11y: string;
  let timeInside = false;

  if (item.kind === "text") {
    bubbleStyle = { backgroundColor: out ? t.outgoing : t.incoming };
    content = <Text style={[type.body, { color: fg }]} selectable>{item.payload.text}</Text>;
    a11y = item.payload.text;
  } else if (item.kind === "media") {
    bubbleStyle = { backgroundColor: out ? t.outgoing : t.incoming };
    content = <View style={{ gap: 8 }}><MediaContent payload={item.payload} onOpen={onOpenMedia} color={fg} />{item.payload.caption ? <Text style={[type.body, { color: fg }]} selectable>{item.payload.caption}</Text> : null}</View>;
    a11y = mediaLabel(item.payload) + (item.payload.caption ? ": " + item.payload.caption : "");
  } else if (item.kind === "board") {
    // A decision is a small marker in the thread; the board itself (options, votes) lives on the Decisions page.
    return (
      <View style={styles.pillRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Decision: ${item.payload.title}. Open decisions`} disabled={!onOpenDecisions} onPress={onOpenDecisions} style={[styles.pill, { borderColor: t.line, backgroundColor: t.surface }]}>
          <Text style={[type.meta, { color: t.accent, fontWeight: "700" }]}>Decision</Text>
          <Text style={[type.meta, { color: t.ink, flexShrink: 1 }]} numberOfLines={1}>{item.payload.title}</Text>
          <Text style={[type.meta, { color: t.muted }]}>{timeLabel(m.sentAt)}</Text>
        </Pressable>
      </View>
    );
  } else if (item.kind === "share") {
    const p = item.payload;
    const location = p.type === "location";
    const url = sharedAttachmentUrl(p);
    bubbleStyle = { backgroundColor: out ? t.outgoing : t.incoming, minWidth: 220 };
    content = <View style={{ gap: 8 }}>
      <Ionicons name={location ? "location-outline" : "person-circle-outline"} size={28} color={fg} />
      <Text style={[type.meta, { color: fg }]}>{location ? "Location pin" : "Contact"}</Text>
      <Text style={[type.body, { color: fg, fontWeight: "700" }]}>{p.title}</Text>
      <Text selectable style={[type.meta, { color: fg }]}>{p.type === "location" ? [p.address, `${p.latitude}, ${p.longitude}`].filter(Boolean).join("\n") : [p.role, p.phone, p.handle].filter(Boolean).join("\n")}</Text>
      {url ? <Pressable accessibilityRole="button" onPress={() => { void Linking.openURL(url).catch(() => Alert.alert("Couldn't open", "No app is available to open this link.")); }} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: fg, textDecorationLine: "underline" }}>{location ? "Open in maps" : "Call contact"}</Text></Pressable> : null}
    </View>;
    a11y = `${location ? "Location" : "Contact"}: ${p.title}`;
  } else if (item.kind === "card") {
    // An event or a meeting someone shared: a small card with what and when.
    const p = item.payload;
    const meeting = p.type === "meeting";
    bubbleStyle = { backgroundColor: out ? t.outgoing : t.incoming, minWidth: 220 };
    content = (
      <View style={styles.cardRow}>
        <View style={[styles.cardIcon, { backgroundColor: out ? "rgba(255,255,255,0.18)" : t.background }]}>
          <Ionicons name={meeting ? "time-outline" : "calendar-outline"} size={22} color={out ? t.onOutgoing : t.accent} />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={[type.meta, { color: fg, opacity: 0.8 }]}>{meeting ? "Meeting" : "Event"}</Text>
          <Text style={[type.body, { color: fg, fontWeight: "700" }]}>{p.title}</Text>
          <Text style={[type.meta, { color: fg }]}>{cardWhen(p)}</Text>
        </View>
      </View>
    );
    a11y = `${meeting ? "Meeting" : "Event"}: ${p.title}, ${cardWhen(p)}`;
  } else if (item.kind === "feature") {
    bubbleStyle = { backgroundColor: out ? t.outgoing : t.incoming };
    content = <Text style={{ color: fg }}>Attachment</Text>;
    a11y = "Attachment";
  } else if (item.unreadable) {
    timeInside = true;
    bubbleStyle = { borderWidth: 1.5, borderStyle: "dashed", borderColor: t.warn, backgroundColor: t.warnSurface, alignItems: "center", minWidth: 200 };
    content = (
      <>
        <Text style={[type.body, { color: t.warn, textAlign: "center" }]}>Can't open this message.</Text>
        {m.body.state === "unreadable" && m.body.code ? <Text style={[type.meta, { color: t.warn, textAlign: "center" }]}>({m.body.code})</Text> : null}
        {m.body.state === "unreadable" && m.body.retryable && onRetryOpen ? (
          <Pressable onPress={() => onRetryOpen(m.id)} accessibilityRole="button" hitSlop={8}><Text style={[type.meta, styles.link, { color: t.warn }]}>Try again</Text></Pressable>
        ) : null}
      </>
    );
    a11y = "Message couldn't be decrypted";
  } else {
    timeInside = true;
    bubbleStyle = { borderWidth: 1.5, borderStyle: "dashed", borderColor: t.sealed, alignItems: "center", minWidth: 180 };
    content = <Text style={[type.body, styles.quiet, { color: t.sealed, textAlign: "center" }]}>Encrypted message</Text>;
    a11y = "Encrypted message, can't be opened on this device";
  }

  const failed = m.delivery === "failed";
  const time = m.delivery === "sending" ? "Sending" : timeLabel(m.sentAt);
  return (
    <View style={[styles.row, { alignItems: align }]}>
      <View style={[styles.bubble, bubbleStyle]} accessible accessibilityLabel={`${out ? "You" : "Them"}: ${a11y}`}>
        {content}
        {timeInside && !failed ? <Text style={[type.meta, styles.timeInside, { color: t.muted }]}>{time}</Text> : null}
      </View>
      {failed && m.failure ? <Text accessibilityRole="alert" style={[type.meta, { color: t.warn, marginTop: space.s, marginRight: space.s, maxWidth: 280, textAlign: "right" }]}>{m.failure}</Text> : null}
      {failed ? (
        <View style={styles.failRow}>
          <Pressable onPress={() => onRetry?.(m.id)} accessibilityRole="button" hitSlop={8}><Text style={[type.meta, styles.link, { color: t.muted }]}>Retry</Text></Pressable>
          <Pressable onPress={() => onDiscard?.(m.id)} accessibilityRole="button" hitSlop={8}><Text style={[type.meta, styles.link, { color: t.muted }]}>Delete</Text></Pressable>
        </View>
      ) : !timeInside ? (
        <Text style={[type.meta, styles.time, { color: t.muted }]}>{time}</Text>
      ) : null}
    </View>
  );
}

function MediaContent({ payload, onOpen, color }: { payload: MediaPayload; onOpen?: (p: MediaPayload) => Promise<string>; color: string }) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const cached = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (cached.current && cached.current !== payload.localUri) { try { new File(cached.current).delete(); } catch {} } }; }, [payload.localUri]);
  async function open() {
    if (!onOpen || busy) return;
    setBusy(true); setError(false);
    try { const next = await onOpen(payload); if (!alive.current) { if (next !== payload.localUri) { try { new File(next).delete(); } catch {} } return; } cached.current = next; setUri(next); }
    catch { if (alive.current) setError(true); }
    finally { if (alive.current) setBusy(false); }
  }
  return uri ? <MediaPreview uri={uri} kind={payload.mediaKind} /> : <Pressable accessibilityRole="button" accessibilityLabel={"Open " + mediaLabel(payload)} onPress={() => void open()} disabled={busy || !onOpen} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Ionicons name={payload.mediaKind === "VOICE" ? "play-circle-outline" : payload.mediaKind === "VIDEO" ? "videocam-outline" : "image-outline"} size={28} color={color} /><Text style={{ color }}>{busy ? "Opening…" : error ? "Couldn't open. Tap to retry" : mediaLabel(payload)}</Text></Pressable>;
}

export const MessageBubble = memo(BubbleImpl);

const styles = StyleSheet.create({
  pillRow: { alignItems: "center", paddingHorizontal: space.l, marginVertical: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: space.s, maxWidth: "92%", paddingHorizontal: space.m, paddingVertical: space.s, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: space.m, marginVertical: 5 },
  bubble: { maxWidth: "84%", paddingHorizontal: space.l, paddingVertical: space.m, borderRadius: radius.bubble + 4 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: space.m },
  cardIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  quiet: { fontStyle: "italic" },
  time: { marginTop: space.xs, marginHorizontal: space.xs },
  timeInside: { marginTop: 2 },
  failRow: { flexDirection: "row", gap: space.l, marginTop: space.s, marginRight: space.s },
  link: { fontSize: 14, lineHeight: 18, textDecorationLine: "underline" }
});

// Renders one decrypted message of any type. Build a ThreadIndex from every
// decrypted message (indexThread), render index.visible, and pass the same
// index here so polls and events fold in their votes and RSVPs.

import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { ContentMessage, FileContent, HIDDEN_TYPES, MessageContent, RsvpResponse } from "../content/types";
import { AttachmentService, formatBytes } from "../attachments/AttachmentService";
import { PollCard } from "../features/polls/Poll";
import { EventCard, MeetingCard } from "../features/schedule/Schedule";
import { LocationCard } from "../features/location/Location";
import { ContactCard } from "../features/contact/Contact";
import { VoicePlayer } from "../features/voice/Voice";
import { palette as c, space } from "../ui/tokens";
import { ThreadIndex, rsvpsFor, votesFor } from "./threadIndex";

export interface ContentBubbleProps {
  message: ContentMessage;
  /** From indexThread(allDecrypted). Votes, RSVPs and session ends are read from it. */
  index: ThreadIndex;
  selfId: string;
  peerName: string;
  nameOf: (id: string) => string;
  attachments: AttachmentService;
  send: (content: MessageContent) => Promise<void>;
  onOpenFile: (file: FileContent) => void;
  onJoinLive: (sessionId: string) => void;
}

export function ContentBubble(p: ContentBubbleProps) {
  const { content } = p.message;
  const out = p.message.outgoing;
  if (HIDDEN_TYPES.has(content.type)) return null;

  switch (content.type) {
    case "text":
      return (
        <View style={[styles.text, out ? styles.textOut : styles.textIn]}>
          <Text style={[styles.body, out && { color: c.outgoingInk }]} selectable>
            {content.text}
          </Text>
        </View>
      );
    case "file":
      return <FileBubble file={content} outgoing={out} attachments={p.attachments} onOpen={() => p.onOpenFile(content)} />;
    case "location":
      return <LocationCard loc={content} outgoing={out} />;
    case "contact":
      return <ContactCard contact={content} outgoing={out} />;
    case "poll":
      return (
        <PollCard
          poll={content}
          messages={votesFor(p.index, content.pollId)}
          selfId={p.selfId}
          peerName={p.peerName}
          nameOf={p.nameOf}
          outgoing={out}
          onVote={(optionIds) => p.send({ type: "poll_vote", pollId: content.pollId, optionIds })}
        />
      );
    case "event":
      return (
        <EventCard
          event={content}
          messages={rsvpsFor(p.index, content.eventId)}
          selfId={p.selfId}
          nameOf={p.nameOf}
          outgoing={out}
          onRsvp={(response: RsvpResponse) => p.send({ type: "event_rsvp", eventId: content.eventId, response })}
        />
      );
    case "meeting":
      return <MeetingCard meeting={content} outgoing={out} onJoin={() => p.onJoinLive(content.meetingId)} />;
    case "live_session":
      return (
        <LiveBanner
          ended={content.state === "ended" || p.index.endedSessions.has(content.sessionId)}
          screen={!!content.screenShare}
          who={out ? "You" : p.peerName}
          onJoin={() => p.onJoinLive(content.sessionId)}
        />
      );
    default:
      return null;
  }
}

function FileBubble({ file, outgoing, attachments, onOpen }: { file: FileContent; outgoing: boolean; attachments: AttachmentService; onOpen: () => void }) {
  // Photos decrypt automatically for a thumbnail; everything else waits for a tap.
  const [thumb, setThumb] = useState<string | null>(null);
  const [voicePath, setVoicePath] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (file.fileKind !== "image" || file.size > 15 * 1024 * 1024) return;
    let alive = true;
    attachments.open(file).then((p) => alive && setThumb(p)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [file, attachments]);

  if (file.fileKind === "voice") {
    return (
      <View style={[styles.fileCard, outgoing ? styles.cardOut : styles.cardIn]}>
        {voicePath ? (
          <VoicePlayer path={voicePath} durationMs={file.durationMs} waveform={file.waveform} outgoing={outgoing} />
        ) : (
          <Pressable
            onPress={() => attachments.open(file).then(setVoicePath).catch(() => setFailed(true))}
            accessibilityRole="button"
            accessibilityLabel="Load voice message"
            style={styles.row}
          >
            <View style={styles.play}>
              <Text style={styles.playText}>▶</Text>
            </View>
            <Text style={[styles.meta, outgoing && { color: "#C9DBE0" }]}>Voice message{file.durationMs ? `, ${Math.round(file.durationMs / 1000)}s` : ""}</Text>
          </Pressable>
        )}
        {failed ? <Text style={styles.err}>Couldn't load. Tap to try again.</Text> : null}
      </View>
    );
  }

  if (file.fileKind === "image") {
    const ratio = file.width && file.height ? Math.max(0.5, Math.min(2, file.width / file.height)) : 4 / 3;
    return (
      <Pressable onPress={onOpen} accessibilityRole="imagebutton" accessibilityLabel={file.caption ?? (file.aiPrompt ? "AI image" : "Photo")} style={[styles.photo, outgoing ? styles.cardOut : styles.cardIn]}>
        <View style={[styles.photoFrame, { aspectRatio: ratio }]}>
          {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : failed ? <Text style={styles.err}>Can't open this photo</Text> : <ActivityIndicator color={c.muted} />}
          {file.aiPrompt ? (
            <View style={styles.aiTag}>
              <Text style={styles.aiText}>AI image</Text>
            </View>
          ) : null}
        </View>
        {file.caption ? <Text style={[styles.caption, outgoing && { color: c.outgoingInk }]}>{file.caption}</Text> : null}
      </Pressable>
    );
  }

  const ext = (file.name.split(".").pop() ?? "").slice(0, 4).toUpperCase();
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${file.name}, ${formatBytes(file.size)}. Open`} style={[styles.fileCard, styles.row, outgoing ? styles.cardOut : styles.cardIn]}>
      <View style={styles.docIcon}>
        <Text style={styles.docExt}>{file.fileKind === "video" ? "VIDEO" : ext || "FILE"}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.fileName, outgoing && { color: c.outgoingInk }]} numberOfLines={2}>
          {file.name}
        </Text>
        <Text style={[styles.meta, outgoing && { color: "#C9DBE0" }]}>
          {formatBytes(file.size)}
          {file.replaces ? ", edited version" : ""}
        </Text>
      </View>
    </Pressable>
  );
}

function LiveBanner({ ended, screen, who, onJoin }: { ended: boolean; screen: boolean; who: string; onJoin: () => void }) {
  if (ended) {
    return (
      <View style={styles.liveEnded}>
        <Text style={styles.meta}>{screen ? "Screen share ended" : "Call ended"}</Text>
      </View>
    );
  }
  return (
    <Pressable onPress={onJoin} accessibilityRole="button" style={styles.live}>
      <View style={styles.liveTag}>
        <Text style={styles.liveTagText}>LIVE</Text>
      </View>
      <Text style={styles.liveTitle}>{screen ? `${who} ${who === "You" ? "are" : "is"} sharing a screen` : `${who} started a call`}</Text>
      <View style={styles.joinPill}>
        <Text style={styles.joinText}>{who === "You" ? "Return" : "Join"}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  text: { maxWidth: "80%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  textIn: { backgroundColor: c.surface, borderBottomLeftRadius: 6, alignSelf: "flex-start" },
  textOut: { backgroundColor: c.outgoing, borderBottomRightRadius: 6, alignSelf: "flex-end" },
  body: { fontSize: 16, lineHeight: 22, color: c.ink },
  fileCard: { width: 260, borderRadius: 18, padding: 12 },
  cardIn: { backgroundColor: c.surface, borderBottomLeftRadius: 6 },
  cardOut: { backgroundColor: c.outgoing, borderBottomRightRadius: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  docIcon: { width: 40, height: 48, borderRadius: 6, backgroundColor: "#F4F8F9", alignItems: "center", justifyContent: "flex-end", paddingBottom: 6, borderWidth: 1, borderColor: c.line },
  docExt: { fontSize: 9, fontWeight: "700", color: c.danger },
  fileName: { fontSize: 15, fontWeight: "600", color: c.ink },
  meta: { fontSize: 13, color: c.muted },
  err: { fontSize: 12, color: c.warn },
  photo: { width: 260, borderRadius: 18, padding: 4, overflow: "hidden" },
  photoFrame: { width: "100%", borderRadius: 14, overflow: "hidden", backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
  caption: { fontSize: 15, color: c.ink, paddingHorizontal: 10, paddingVertical: 8 },
  aiTag: { position: "absolute", left: 8, top: 8, backgroundColor: c.surface, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: c.warn },
  aiText: { fontSize: 11, fontWeight: "600", color: c.warn },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.secure, alignItems: "center", justifyContent: "center" },
  playText: { color: "#fff" },
  live: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.ink, marginVertical: space.xs },
  liveTag: { backgroundColor: c.danger, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  liveTagText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  liveTitle: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "600" },
  joinPill: { backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  joinText: { color: c.ink, fontWeight: "600", fontSize: 14 },
  liveEnded: { alignSelf: "center", backgroundColor: c.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
});

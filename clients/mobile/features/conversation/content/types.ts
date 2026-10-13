// Every non-text message is one of these, serialized to JSON and then
// encrypted by the MLS layer exactly like a text message. The server only
// ever sees ciphertext. File bytes travel separately as encrypted blobs; the
// key to each blob lives inside the encrypted FileContent below.

export const CONTENT_VERSION = 1;

export type FileKind = "document" | "image" | "video" | "voice";

export interface FileContent {
  type: "file";
  fileKind: FileKind;
  name: string;
  mime: string;
  size: number; // plaintext bytes
  blobId: string; // where the ciphertext lives
  key: string; // base64, per-file random key
  nonce: string; // base64
  sha256: string; // hex, of plaintext, checked after decrypt
  caption?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[]; // 0..1 samples for voice notes
  /** Set when this file is an edited version of an earlier file message. */
  replaces?: string;
  /** Set when the image came from the AI image service. */
  aiPrompt?: string;
}

/**
 * A photo with viewing rules (view limit, time window, view once). The ciphertext lives on the
 * server and the key rides in this end-to-end encrypted message, so only the recipient can open it.
 */
export interface ProtectedMediaContent {
  type: "protected_media";
  v: 1;
  mediaId: string;
  secret: { key: string; nonce: string }; // base64
  mime: "image/jpeg";
  width: number;
  height: number;
  mode: "MULTI_VIEW" | "TIMED" | "EPHEMERAL";
  maxViews: number | null;
  windowSeconds: number | null;
  expiryStart: "ON_SEND" | "ON_FIRST_VIEW" | null;
}

export interface TextContent {
  type: "text";
  text: string;
  replyTo?: string;
}

export interface LocationContent {
  type: "location";
  latitude: number;
  longitude: number;
  accuracyM?: number;
  label?: string; // what the sender typed, e.g. "North gate"
  address?: string;
}

export interface ContactContent {
  type: "contact";
  name: string;
  phones?: { label?: string; number: string }[];
  emails?: { label?: string; address: string }[];
  organization?: string;
  jobTitle?: string;
}

export interface PollContent {
  type: "poll";
  pollId: string;
  question: string;
  options: { id: string; label: string }[];
  multi: boolean;
  hideVoters: boolean;
  closesAt?: string; // ISO
}

export interface PollVoteContent {
  type: "poll_vote";
  pollId: string;
  optionIds: string[]; // empty = retract
}

export interface EventContent {
  type: "event";
  eventId: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  allDay?: boolean;
  place?: string;
  note?: string;
  remind?: boolean;
}

export type RsvpResponse = "going" | "maybe" | "declined";

export interface EventRsvpContent {
  type: "event_rsvp";
  eventId: string;
  response: RsvpResponse;
}

export interface MeetingContent {
  type: "meeting";
  meetingId: string;
  title: string;
  startsAt: string;
  durationMin: number;
  note?: string;
  remind?: boolean;
}

export interface LiveSessionContent {
  type: "live_session";
  sessionId: string;
  state: "started" | "ended";
  screenShare?: boolean;
  /** Associates a fresh call attempt with a scheduled meeting. */
  meetingId?: string;
  /** Final whiteboard, saved as an encrypted image when the session ends. */
  boardSnapshot?: FileContent;
}

/** Call setup messages. Never shown in the thread. */
export interface RtcSignalContent {
  type: "rtc_signal";
  sessionId: string;
  signal:
    | { kind: "description"; sdp: { type: string; sdp: string } }
    | { kind: "candidate"; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } }
    | { kind: "hangup" };
}

export type MessageContent =
  | TextContent
  | FileContent
  | ProtectedMediaContent
  | LocationContent
  | ContactContent
  | PollContent
  | PollVoteContent
  | EventContent
  | EventRsvpContent
  | MeetingContent
  | LiveSessionContent
  | RtcSignalContent;

export type ContentType = MessageContent["type"];

/** Types that change other messages' state rather than showing as bubbles. */
export const HIDDEN_TYPES: ReadonlySet<ContentType> = new Set(["poll_vote", "event_rsvp", "rtc_signal"]);

/** What the screen needs from the existing ConversationService. */
export interface ContentTransport {
  sendContent(conversationId: string, content: MessageContent): Promise<{ id: string; sentAt: string }>;
}

/** A decrypted message with its parsed content. */
export interface ContentMessage {
  id: string;
  senderId: string;
  sentAt: string;
  outgoing: boolean;
  content: MessageContent;
}

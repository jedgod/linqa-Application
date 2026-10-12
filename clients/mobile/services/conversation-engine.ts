/**
 * Conversation page logic (from the Linqa Conversation v2 pack, adapted to the app's own chat API).
 *
 * Everything a message means (its text, its lane, a decision board, a vote) lives INSIDE the encrypted
 * payload, so the server only ever sees ciphertext. This file holds the parts that need no network and no
 * keys: the themes, the rules a payload must follow, and how a list of opened messages becomes what the
 * screen draws (with votes counted on the device, one vote per person, latest vote wins).
 */

import { ALL_ACTIONS, BACKGROUNDS, isChatBackground, type ChatBackground, type ThreadAction } from "./conversation-thread";
import type { SharedAttachment } from "./shared-attachment";
import { validateContent } from "../features/conversation/content/codec";
import type { MessageContent } from "../features/conversation/content/types";

/** The look of the conversation pages: "system" follows the phone, or the person picks Light or Dark. */
export type ThemeChoice = "system" | "light" | "dark";
export type ThemeName = "light" | "dark";
export type Theme = {
  background: string; surface: string; ink: string; muted: string; accent: string; onAccent: string; outgoing: string; onOutgoing: string;
  incoming: string; highlight: string; line: string; secure: string; sealed: string; warn: string; warnSurface: string; danger: string;
};

export const THEMES: Record<ThemeName, Theme> = {
  light: { background: "#ECEEF1", surface: "#FFFFFF", ink: "#111615", muted: "#667078", accent: "#2E7D4F", onAccent: "#FFFFFF", outgoing: "#195D50", onOutgoing: "#F4F8F9", incoming: "#FFFFFF", highlight: "#DDEFE3", line: "#D8DEE3", secure: "#2E7D4F", sealed: "#7A8B99", warn: "#A8641A", warnSurface: "#FBF1E3", danger: "#D92D20" },
  dark: { background: "#12181D", surface: "#1B242B", ink: "#E6ECF1", muted: "#93A3B1", accent: "#4FB37A", onAccent: "#0E1A13", outgoing: "#1F6B58", onOutgoing: "#F4F8F9", incoming: "#25313A", highlight: "#21402F", line: "#2C3A46", secure: "#5FB39A", sealed: "#7F91A0", warn: "#E0A458", warnSurface: "#2C2418", danger: "#F26B60" }
};
export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];
export const isThemeChoice = (value: unknown): value is ThemeChoice => value === "system" || value === "light" || value === "dark";
/** "system" follows the phone setting (light when it cannot tell). */
export const resolveTheme = (choice: ThemeChoice, system: string | null | undefined): Theme => THEMES[choice === "system" ? (system === "dark" ? "dark" : "light") : choice];

export const LANES = ["All", "Plans", "Ideas"] as const;
export type Lane = (typeof LANES)[number];
export type TextLane = "Plans" | "Ideas" | "General";

/** The message a reply answers: its id, who wrote it, and a short quote. Sealed inside the message like everything else. */
export type ReplyRef = { id: string; senderId: string; text: string };

export type MediaPayload = { type: "media"; mediaId: string; mediaKind: "VOICE" | "VIDEO" | "GIF" | "PHOTO"; mimeType: string; durationMs?: number; mediaKey?: string; localUri?: string; caption?: string; mediaDigest?: string };

export type Payload =
  | { type: "feature"; content: MessageContent }
  | SharedAttachment
  | MediaPayload
  | { type: "text"; text: string; lane: TextLane; reply?: ReplyRef; forwarded?: boolean }
  | { type: "decision"; title: string; options: string[] }
  | { type: "vote"; boardId: string; choice: number }
  | { type: "event"; title: string; startsAt: string; place?: string }
  | { type: "meeting"; title: string; startsAt: string; durationMinutes: number };

export const MAX_TEXT = 8000;
export const MAX_TITLE = 200;
export const MAX_OPTION = 100;
export const MAX_CARD_TITLE = 120;

/** Throws a plain-language Error for anything the conversation does not support. */
export function validatePayload(p: unknown): Payload {
  const x = p as Record<string, unknown> | null;
  if (!x || typeof x !== "object" || !["text", "decision", "vote", "event", "meeting", "media", "location", "contact", "feature"].includes(x.type as string)) throw new Error("Unsupported message");
  if (x.type === "feature" && !validateContent(x.content)) throw new Error("Invalid feature message");
  if (x.type === "location" || x.type === "contact") {
    if (typeof x.title !== "string" || !x.title.trim() || x.title.length > MAX_CARD_TITLE) throw new Error("Enter a name or location label (up to 120 characters).");
    if (x.type === "location") {
      if (typeof x.latitude !== "number" || !Number.isFinite(x.latitude) || Math.abs(x.latitude) > 90 || typeof x.longitude !== "number" || !Number.isFinite(x.longitude) || Math.abs(x.longitude) > 180) throw new Error("Enter valid latitude (-90 to 90) and longitude (-180 to 180).");
      if (x.address !== undefined && (typeof x.address !== "string" || x.address.length > 300)) throw new Error("Address must be 300 characters or less.");
    } else {
      for (const field of ["role", "phone", "handle"]) if (x[field] !== undefined && (typeof x[field] !== "string" || (x[field] as string).length > 120)) throw new Error("Contact details must be 120 characters or less.");
      if (!(typeof x.phone === "string" && x.phone.trim()) && !(typeof x.handle === "string" && x.handle.trim())) throw new Error("Enter a phone number or Linqa handle.");
      if (x.phone !== undefined && (typeof x.phone !== "string" || !/^\+?[0-9 () .-]{3,40}$/.test(x.phone))) throw new Error("Enter a valid phone number.");
    }
  }
  if (x.type === "media") {
    if (typeof x.mediaId !== "string" || !/^[0-9a-f-]{36}$/i.test(x.mediaId) || !["VOICE", "VIDEO", "GIF", "PHOTO"].includes(x.mediaKind as string) || typeof x.mimeType !== "string" || !/^(audio\/(mp4|aac|mpeg|x-m4a)|video\/(mp4|quicktime)|image\/(gif|jpeg|png|webp))$/.test(x.mimeType) || (x.durationMs !== undefined && (typeof x.durationMs !== "number" || !Number.isFinite(x.durationMs) || x.durationMs < 0))) throw new Error("Invalid media");
    if ((x.mediaKind === "VOICE" && !x.mimeType.startsWith("audio/")) || (x.mediaKind === "VIDEO" && !x.mimeType.startsWith("video/")) || (x.mediaKind === "PHOTO" && !x.mimeType.startsWith("image/")) || (x.mediaKind === "GIF" && x.mimeType !== "image/gif")) throw new Error("Invalid media type");
    if (x.mediaDigest !== undefined && (typeof x.mediaDigest !== "string" || !/^[a-f0-9]{64}$/.test(x.mediaDigest))) throw new Error("Invalid media digest");
    if (x.caption !== undefined && (typeof x.caption !== "string" || x.caption.length > MAX_TEXT)) throw new Error("Invalid media caption");
    if (x.mediaKind === "VIDEO" && x.durationMs !== undefined && (x.durationMs as number) > 60_000) throw new Error("Video must be 60 seconds or less");
    if (x.mediaKey !== undefined && (typeof x.mediaKey !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(x.mediaKey))) throw new Error("Invalid media key");
  }
  if (x.type === "text") {
    if (typeof x.text !== "string" || !x.text.trim() || x.text.length > MAX_TEXT || !["Plans", "Ideas", "General"].includes(x.lane as string)) throw new Error("Invalid message");
    const reply = x.reply as Record<string, unknown> | undefined;
    if (reply !== undefined && !(reply && typeof reply === "object" && typeof reply.id === "string" && reply.id.length <= 80 && typeof reply.senderId === "string" && reply.senderId.length <= 80 && typeof reply.text === "string" && reply.text.length <= 200)) throw new Error("Invalid reply");
    if (x.forwarded !== undefined && typeof x.forwarded !== "boolean") throw new Error("Invalid message");
  }
  if (x.type === "decision") {
    const options = x.options;
    if (typeof x.title !== "string" || !x.title.trim() || x.title.length > MAX_TITLE || !Array.isArray(options) || options.length < 2 || options.length > 5
      || new Set(options).size !== options.length || options.some((o) => typeof o !== "string" || !o.trim() || o.length > MAX_OPTION)) throw new Error("Invalid decision");
  }
  if (x.type === "vote") {
    if (typeof x.boardId !== "string" || !x.boardId || !Number.isInteger(x.choice) || (x.choice as number) < 0 || (x.choice as number) > 4) throw new Error("Invalid vote");
  }
  if (x.type === "event" || x.type === "meeting") {
    const when = typeof x.startsAt === "string" ? Date.parse(x.startsAt) : Number.NaN;
    if (typeof x.title !== "string" || !x.title.trim() || x.title.length > MAX_CARD_TITLE || Number.isNaN(when)) throw new Error(x.type === "event" ? "Invalid event" : "Invalid meeting");
    if (x.type === "event" && x.place !== undefined && (typeof x.place !== "string" || x.place.length > MAX_CARD_TITLE)) throw new Error("Invalid event");
    if (x.type === "meeting" && !(Number.isInteger(x.durationMinutes) && (x.durationMinutes as number) >= 5 && (x.durationMinutes as number) <= 480)) throw new Error("Invalid meeting");
  }
  return x as unknown as Payload;
}

/** A message as the server returns it (ciphertext only) plus, once opened, its payload. */
export type Envelope = { id: string; senderUserId: string; ciphertext: string | null; createdAt: string; kind: string };
export type OpenedMessage = Envelope & { payload: Payload };
export type Row =
  | (OpenedMessage & { payload: Extract<Payload, { type: "feature" }> })
  | (OpenedMessage & { payload: Extract<Payload, { type: "text" }> })
  | (OpenedMessage & { payload: Extract<Payload, { type: "decision" }>; votes: Record<string, number> })
  | (OpenedMessage & { payload: Extract<Payload, { type: "event" | "meeting" | "location" | "contact" }> })
  | (OpenedMessage & { payload: MediaPayload });

const byTime = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Oldest first. Text stays as is; a decision becomes a board; votes are folded into their board
 * (one per person, the latest wins, a choice outside the board is ignored, a vote for an unknown board is dropped).
 */
export function projectMessages(messages: OpenedMessage[]): Row[] {
  const sorted = [...messages].sort(byTime);
  const boards = new Map<string, Row & { votes: Record<string, number> }>();
  const rows: Row[] = [];
  for (const m of sorted) {
    const p = m.payload;
    if (p.type === "text" || p.type === "event" || p.type === "meeting" || p.type === "media" || p.type === "location" || p.type === "contact" || p.type === "feature") rows.push(m as Row);
    else if (p.type === "decision") {
      // A vote names its board by the board's message id.
      const board = { ...m, payload: p, votes: {} } as Row & { votes: Record<string, number> };
      boards.set(m.id, board); rows.push(board);
    } else if (p.type === "vote") {
      const board = boards.get(p.boardId);
      if (board && board.payload.type === "decision" && p.choice < board.payload.options.length) board.votes[m.senderUserId] = p.choice;
    }
  }
  return rows;
}

/** Messages shown in a lane: "All" shows everything; Plans and Ideas show their own text plus every decision board. */
export function inLane(row: Row, lane: Lane): boolean {
  return lane === "All" || row.payload.type === "decision" || (row.payload.type === "text" && row.payload.lane === lane);
}

export const countVotes = (votes: Record<string, number>, index: number) => Object.values(votes).filter((v) => v === index).length;
export const voteCount = (row: Extract<Row, { payload: { type: "decision" } }>, index: number) => Object.values(row.votes).filter((v) => v === index).length;

/** "3:05 PM", or the date for older messages. */
export function timeLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

/** What a failed send or load looks like to the person; server codes never reach the screen. */
export function conversationError(code: string | undefined): string {
  switch (code) {
    case "CONVERSATION_NOT_FOUND": case "NOT_A_MEMBER": return "This conversation is no longer available.";
    case "CHAT_UNAVAILABLE": case "CHAT_NOT_PERMITTED": return "You can't message this person right now.";
    case "RECIPIENT_NOT_READY": case "RECIPIENT_UNKNOWN": return "They haven't set up secure messaging on a phone yet, so this can't be sent.";
    case "OWN_DEVICE_NOT_PUBLISHED": return "Secure messaging is still setting up on this phone. Try again in a moment.";
    case "RATE_LIMITED": return "You're sending too fast. Wait a moment and try again.";
    case "NETWORK": return "No connection. Check your network and try again.";
    default: return "Something went wrong. Try again.";
  }
}

/**
 * Kept on this device. `quiet` is also sent to the server as the conversation's mute, so alerts really stop;
 * `verified` is the person marking the safety number as checked.
 */
/**
 * Kept on this device only. `quiet` is mirrored to the server (mute) so alerts really stop; `verified` is the person
 * marking the safety number as checked; `features` are the composer actions this conversation shows; `background` is the chat backdrop.
 */
export type ConversationPrefs = { theme: ThemeChoice; quiet: boolean; verified: boolean; features: ThreadAction[]; background: ChatBackground };
export const DEFAULT_PREFS: ConversationPrefs = { theme: "system", quiet: false, verified: false, features: ALL_ACTIONS.filter(id => id !== "AI_IMAGE"), background: "AUTO" };

/** Reads stored preferences; anything unreadable or unknown (including the older colour themes) falls back to the defaults. */
export function parsePrefs(raw: string | null | undefined): ConversationPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const value = JSON.parse(raw) as { theme?: unknown; quiet?: unknown; verified?: unknown; features?: unknown; background?: unknown };
    const features = Array.isArray(value.features) ? ALL_ACTIONS.filter((id) => (value.features as unknown[]).includes(id)) : DEFAULT_PREFS.features;
    return {
      theme: isThemeChoice(value.theme) ? value.theme : DEFAULT_PREFS.theme, quiet: value.quiet === true, verified: value.verified === true,
      features, background: isChatBackground(value.background) ? value.background : "AUTO"
    };
  } catch { return DEFAULT_PREFS; }
}

/**
 * The look of the chat thread itself. A fixed background brings a palette that reads on it: the dark one (Ink) gets the
 * dark palette, the light ones get the light palette. Auto keeps whatever the conversation theme is.
 */
export function chatTheme(base: Theme, background: ChatBackground): Theme {
  if (background === "AUTO") return base;
  return { ...(background === "INK" ? THEMES.dark : THEMES.light), background: BACKGROUNDS[background] };
}

/**
 * What a decrypted message holds. New messages are a JSON payload ({type:"text"|"decision"|"vote", ...}).
 * Anything else (older plain text) is shown as an ordinary message in the General lane.
 */
export function parseBody(plaintext: string): Payload | null {
  const trimmed = plaintext.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    let candidate: unknown;
    try { candidate = JSON.parse(trimmed); } catch { /* Older text can start with a brace. */ }
    if ((candidate as { type?: string } | null)?.type === "feature") { try { return validatePayload(candidate); } catch { return null; } }
    try { const parsed = validatePayload(JSON.parse(trimmed)); return parsed.type === "media" ? { type: "media", mediaId: parsed.mediaId, mediaKind: parsed.mediaKind, mimeType: parsed.mimeType, ...(parsed.mediaDigest ? { mediaDigest: parsed.mediaDigest } : {}), ...(parsed.caption ? { caption: parsed.caption } : {}), ...(parsed.mediaKey ? { mediaKey: parsed.mediaKey } : {}), ...(parsed.durationMs !== undefined ? { durationMs: parsed.durationMs } : {}) } : parsed; } catch { /* not one of ours: fall through as plain text */ }
  }
  return plaintext.length <= MAX_TEXT ? { type: "text", text: plaintext, lane: "General" } : null;
}

/** Disappearing messages: off, or after a day, a week or four weeks (the only values the server accepts). */
export const DISAPPEAR_CHOICES: Array<{ seconds: number | null; label: string; long: string }> = [
  { seconds: null, label: "Off", long: "off" },
  { seconds: 86_400, label: "1 day", long: "1 day" },
  { seconds: 604_800, label: "1 week", long: "1 week" },
  { seconds: 2_419_200, label: "4 weeks", long: "4 weeks" }
];
export const disappearLabel = (seconds: number | null | undefined): string => DISAPPEAR_CHOICES.find((c) => c.seconds === (seconds ?? null))?.long ?? "off";

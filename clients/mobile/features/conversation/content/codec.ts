// Turns MessageContent into the plaintext string handed to MLS, and back.
// Decoding is strict: anything malformed comes back as null so the UI shows
// "Can't open this message" instead of crashing or rendering junk. Plain
// strings from older app versions decode as text.

import { CONTENT_VERSION, MessageContent } from "./types";

const MAX_TEXT = 8000;
const MAX_LABEL = 300;
const MAX_POLL_OPTIONS = 12;

export function encodeContent(content: MessageContent): string {
  if (!validate(content as unknown as Record<string, unknown>)) throw new Error("INVALID_CONTENT");
  return JSON.stringify({ v: CONTENT_VERSION, c: content });
}

export function decodeContent(plaintext: string): MessageContent | null {
  if (plaintext.length > 131_072) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return plaintext.length <= MAX_TEXT ? { type: "text", text: plaintext } : null;
  }
  if (!isObj(parsed) || typeof parsed.v !== "number" || !isObj(parsed.c)) {
    return typeof parsed === "string" ? { type: "text", text: parsed } : null;
  }
  if (parsed.v !== CONTENT_VERSION) return null;
  return validate(parsed.c);
}

export function validateContent(value: unknown): MessageContent | null {
  return isObj(value) ? validate(value) : null;
}
function validate(c: Record<string, unknown>): MessageContent | null {
  switch (c.type) {
    case "text":
      return str(c.text, MAX_TEXT) && optStr(c.replyTo) ? (c as never) : null;

    case "file":
      return ["document", "image", "video", "voice"].includes(c.fileKind as string) &&
        str(c.name, MAX_LABEL) && !/[\\/\u0000-\u001f]/.test(c.name) &&
        str(c.mime, 200) &&
        Number.isSafeInteger(c.size) && (c.size as number) > 0 && (c.size as number) <= 25 * 1024 * 1024 &&
        typeof c.blobId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(c.blobId) &&
        typeof c.key === "string" && /^[A-Za-z0-9+/]{43}=$/.test(c.key) &&
        typeof c.nonce === "string" && /^[A-Za-z0-9+/]{32}$/.test(c.nonce) &&
        typeof c.sha256 === "string" && /^[0-9a-f]{64}$/.test(c.sha256) &&
        optStr(c.caption, MAX_TEXT) &&
        optStr(c.replaces) &&
        optStr(c.aiPrompt, 2000) &&
        (c.width === undefined || (Number.isSafeInteger(c.width) && (c.width as number) > 0 && (c.width as number) <= 32768)) &&
        (c.height === undefined || (Number.isSafeInteger(c.height) && (c.height as number) > 0 && (c.height as number) <= 32768)) &&
        (c.durationMs === undefined || (num(c.durationMs) && c.durationMs >= 0 && c.durationMs <= (c.fileKind === "voice" ? 300000 : 60000))) &&
        (c.waveform === undefined || (Array.isArray(c.waveform) && c.waveform.length <= 200 && c.waveform.every(x => num(x) && x >= 0 && x <= 1))) &&
        (c.fileKind === "document" || (c.fileKind === "image" && /^image\/(jpeg|png|webp|gif)$/.test(c.mime as string)) || (c.fileKind === "video" && /^video\/(mp4|quicktime)$/.test(c.mime as string)) || (c.fileKind === "voice" && /^audio\/(mp4|aac|mpeg|x-m4a)$/.test(c.mime as string)))
        ? (c as never)
        : null;

    case "location":
      return num(c.latitude) && Math.abs(c.latitude as number) <= 90 &&
        num(c.longitude) && Math.abs(c.longitude as number) <= 180 &&
        optStr(c.label, MAX_LABEL) && optStr(c.address, MAX_LABEL) && (c.accuracyM === undefined || (num(c.accuracyM) && c.accuracyM >= 0 && c.accuracyM <= 100000))
        ? (c as never)
        : null;

    case "contact":
      return str(c.name, MAX_LABEL) &&
        (c.phones === undefined || (Array.isArray(c.phones) && c.phones.length <= 10 && c.phones.every((p) => isObj(p) && str(p.number, 50) && optStr(p.label, 50)))) &&
        (c.emails === undefined || (Array.isArray(c.emails) && c.emails.length <= 10 && c.emails.every((e) => isObj(e) && str(e.address, MAX_LABEL) && optStr(e.label, 50)))) &&
        optStr(c.organization, MAX_LABEL) && optStr(c.jobTitle, MAX_LABEL)
        ? (c as never)
        : null;

    case "poll": {
      const opts = c.options;
      if (!str(c.pollId, 100) || !str(c.question, MAX_LABEL) || !Array.isArray(opts)) return null;
      if (opts.length < 2 || opts.length > MAX_POLL_OPTIONS) return null;
      const ids = new Set<string>();
      for (const o of opts) {
        if (!isObj(o) || !str(o.id, 50) || !str(o.label, MAX_LABEL) || ids.has(o.id as string)) return null;
        ids.add(o.id as string);
      }
      return typeof c.multi === "boolean" && typeof c.hideVoters === "boolean" && optIso(c.closesAt) ? (c as never) : null;
    }

    case "poll_vote":
      return str(c.pollId, 100) && Array.isArray(c.optionIds) && c.optionIds.length <= MAX_POLL_OPTIONS &&
        c.optionIds.every((x) => str(x, 50)) && new Set(c.optionIds).size === c.optionIds.length
        ? (c as never)
        : null;

    case "event":
      return str(c.eventId, 100) && str(c.title, MAX_LABEL) && iso(c.startsAt) && iso(c.endsAt) &&
        Date.parse(c.endsAt as string) >= Date.parse(c.startsAt as string) &&
        optStr(c.place, MAX_LABEL) && optStr(c.note, MAX_TEXT) && optBool(c.allDay) && optBool(c.remind)
        ? (c as never)
        : null;

    case "event_rsvp":
      return str(c.eventId, 100) && ["going", "maybe", "declined"].includes(c.response as string) ? (c as never) : null;

    case "meeting":
      return str(c.meetingId, 100) && str(c.title, MAX_LABEL) && iso(c.startsAt) &&
        Number.isSafeInteger(c.durationMin) && (c.durationMin as number) > 0 && (c.durationMin as number) <= 24 * 60 &&
        optStr(c.note, MAX_TEXT) && optBool(c.remind)
        ? (c as never)
        : null;

    case "live_session":
      return str(c.sessionId, 100) && (c.state === "started" || c.state === "ended") &&
        optBool(c.screenShare) && optStr(c.meetingId, 100) && (c.boardSnapshot === undefined || (isObj(c.boardSnapshot) && c.boardSnapshot.type === "file" && c.boardSnapshot.fileKind === "image" && validate(c.boardSnapshot) !== null))
        ? (c as never)
        : null;

    case "rtc_signal": {
      const s = c.signal;
      if (!str(c.sessionId, 100) || !isObj(s)) return null;
      if (s.kind === "hangup") return c as never;
      if (s.kind === "description") {
        return isObj(s.sdp) && (s.sdp.type === "offer" || s.sdp.type === "answer") && str(s.sdp.sdp, 48_000) ? (c as never) : null;
      }
      if (s.kind === "candidate") return isObj(s.candidate) && typeof s.candidate.candidate === "string" && s.candidate.candidate.length <= 8192 && (s.candidate.sdpMid == null || str(s.candidate.sdpMid, 100)) && (s.candidate.sdpMLineIndex == null || (Number.isSafeInteger(s.candidate.sdpMLineIndex) && (s.candidate.sdpMLineIndex as number) >= 0 && (s.candidate.sdpMLineIndex as number) <= 64)) ? (c as never) : null;
      return null;
    }

    default:
      return null;
  }
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function str(x: unknown, max = 1000): x is string {
  return typeof x === "string" && x.trim().length > 0 && x.length <= max;
}
function optBool(x: unknown) { return x === undefined || typeof x === "boolean"; }
function optStr(x: unknown, max = 1000) {
  return x === undefined || (typeof x === "string" && x.length <= max);
}
function num(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
function iso(x: unknown) {
  return typeof x === "string" && x.length <= 40 && !Number.isNaN(Date.parse(x));
}
function optIso(x: unknown) {
  return x === undefined || iso(x);
}

/** Random id for polls, events, meetings, sessions and whiteboard elements. */
export function newId(prefix = ""): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return prefix + `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

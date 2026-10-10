// Turns MessageContent into the plaintext string handed to MLS, and back.
// Decoding is strict: anything malformed comes back as null so the UI shows
// "Can't open this message" instead of crashing or rendering junk. Plain
// strings from older app versions decode as text.

import { CONTENT_VERSION, MessageContent } from "./types";

const MAX_TEXT = 8000;
const MAX_LABEL = 300;
const MAX_POLL_OPTIONS = 12;

export function encodeContent(content: MessageContent): string {
  return JSON.stringify({ v: CONTENT_VERSION, c: content });
}

export function decodeContent(plaintext: string): MessageContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return plaintext.length <= MAX_TEXT ? { type: "text", text: plaintext } : null;
  }
  if (!isObj(parsed) || typeof parsed.v !== "number" || !isObj(parsed.c)) {
    return typeof parsed === "string" ? { type: "text", text: parsed } : null;
  }
  if (parsed.v > CONTENT_VERSION) return null; // newer app version sent this
  return validate(parsed.c);
}

function validate(c: Record<string, unknown>): MessageContent | null {
  switch (c.type) {
    case "text":
      return str(c.text, MAX_TEXT) && optStr(c.replyTo) ? (c as never) : null;

    case "file":
      return ["document", "image", "video", "voice"].includes(c.fileKind as string) &&
        str(c.name, MAX_LABEL) &&
        str(c.mime, 200) &&
        num(c.size) && (c.size as number) >= 0 &&
        str(c.blobId, 200) &&
        str(c.key, 200) &&
        str(c.nonce, 200) &&
        typeof c.sha256 === "string" && /^[0-9a-f]{64}$/.test(c.sha256) &&
        optStr(c.caption, MAX_TEXT) &&
        optStr(c.replaces) &&
        optStr(c.aiPrompt, 2000) &&
        (c.waveform === undefined || (Array.isArray(c.waveform) && c.waveform.length <= 200 && c.waveform.every(num)))
        ? (c as never)
        : null;

    case "location":
      return num(c.latitude) && Math.abs(c.latitude as number) <= 90 &&
        num(c.longitude) && Math.abs(c.longitude as number) <= 180 &&
        optStr(c.label, MAX_LABEL) && optStr(c.address, MAX_LABEL)
        ? (c as never)
        : null;

    case "contact":
      return str(c.name, MAX_LABEL) &&
        (c.phones === undefined || (Array.isArray(c.phones) && c.phones.length <= 10 && c.phones.every((p) => isObj(p) && str(p.number, 50)))) &&
        (c.emails === undefined || (Array.isArray(c.emails) && c.emails.length <= 10 && c.emails.every((e) => isObj(e) && str(e.address, MAX_LABEL))))
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
        c.optionIds.every((x) => str(x, 50))
        ? (c as never)
        : null;

    case "event":
      return str(c.eventId, 100) && str(c.title, MAX_LABEL) && iso(c.startsAt) && iso(c.endsAt) &&
        Date.parse(c.endsAt as string) >= Date.parse(c.startsAt as string) &&
        optStr(c.place, MAX_LABEL) && optStr(c.note, MAX_TEXT)
        ? (c as never)
        : null;

    case "event_rsvp":
      return str(c.eventId, 100) && ["going", "maybe", "declined"].includes(c.response as string) ? (c as never) : null;

    case "meeting":
      return str(c.meetingId, 100) && str(c.title, MAX_LABEL) && iso(c.startsAt) &&
        num(c.durationMin) && (c.durationMin as number) > 0 && (c.durationMin as number) <= 24 * 60 &&
        optStr(c.note, MAX_TEXT)
        ? (c as never)
        : null;

    case "live_session":
      return str(c.sessionId, 100) && (c.state === "started" || c.state === "ended") &&
        (c.boardSnapshot === undefined || (isObj(c.boardSnapshot) && validate(c.boardSnapshot) !== null))
        ? (c as never)
        : null;

    case "rtc_signal": {
      const s = c.signal;
      if (!str(c.sessionId, 100) || !isObj(s)) return null;
      if (s.kind === "hangup") return c as never;
      if (s.kind === "description") {
        return isObj(s.sdp) && (s.sdp.type === "offer" || s.sdp.type === "answer") && str(s.sdp.sdp, 100_000) ? (c as never) : null;
      }
      if (s.kind === "candidate") return isObj(s.candidate) && typeof s.candidate.candidate === "string" ? (c as never) : null;
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
  return typeof x === "string" && x.length > 0 && x.length <= max;
}
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
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Composer actions and chat backgrounds for the conversation thread (from the Linqa Conversation Thread pack).
 *
 * Media bytes never sit in the page model: an attachment is a vault id, a share is a small structured payload,
 * and either is sealed by the secure core before it is sent. Poll, Event and Meeting can run; capture actions are
 * listed, can be switched on or off, and explain the integration they still need.
 */

import { accessNames, type CaptureAction } from "./conversation-access";

function reasonFor(action: CaptureAction): string {
  const asks = ["VIDEO", "VOICE", "LOCATION", "CONTACT", "LIVE_SCREEN"].includes(action) ? " It will ask first." : "";
  return `Needs ${accessNames(action)} access, which this version doesn't include yet.${asks}`;
}

export type ThreadAction = "PHOTO" | "LOCATION" | "CONTACT" | "DOCUMENT" | "POLL" | "EVENT" | "AI_IMAGE" | "DESIGN" | "LIVE_SCREEN" | "VOICE" | "VIDEO" | "MEETING";

export interface ThreadActionSpec {
  id: ThreadAction;
  label: string;
  group: "MEDIA" | "SHARE" | "CREATE" | "LIVE";
  /** Asks the person before anything is shared or recorded. */
  needsConsent: boolean;
}

export const THREAD_ACTIONS: ThreadActionSpec[] = [
  { id: "PHOTO", label: "Photos", group: "MEDIA", needsConsent: false },
  { id: "VIDEO", label: "Record video", group: "MEDIA", needsConsent: true },
  { id: "VOICE", label: "Record voice", group: "MEDIA", needsConsent: true },
  { id: "DOCUMENT", label: "Document", group: "MEDIA", needsConsent: false },
  { id: "DESIGN", label: "Design / crop", group: "MEDIA", needsConsent: false },
  { id: "AI_IMAGE", label: "AI image", group: "CREATE", needsConsent: false },
  { id: "LOCATION", label: "Location", group: "SHARE", needsConsent: true },
  { id: "CONTACT", label: "Contact", group: "SHARE", needsConsent: true },
  { id: "POLL", label: "Poll", group: "CREATE", needsConsent: false },
  { id: "EVENT", label: "Event", group: "CREATE", needsConsent: false },
  { id: "MEETING", label: "Schedule meeting", group: "LIVE", needsConsent: false },
  { id: "LIVE_SCREEN", label: "Share live screen", group: "LIVE", needsConsent: true }
];

export const ALL_ACTIONS: ThreadAction[] = THREAD_ACTIONS.map((a) => a.id);
export const isThreadAction = (value: unknown): value is ThreadAction => typeof value === "string" && ALL_ACTIONS.includes(value as ThreadAction);

/** Why an action cannot be used yet, from the access it needs (one table, in conversation-access.ts). Poll, Event and Meeting need none and work. */
const NOT_AVAILABLE: Partial<Record<ThreadAction, string>> = {
  PHOTO: reasonFor("PHOTO"), VIDEO: reasonFor("VIDEO"), VOICE: reasonFor("VOICE"), DOCUMENT: reasonFor("DOCUMENT"), DESIGN: reasonFor("DESIGN"),
  LIVE_SCREEN: reasonFor("LIVE_SCREEN"),
  AI_IMAGE: "Not available in this version yet."
};

/** `null` when the action works; otherwise the reason it does not. */
export const unavailableReason = (action: ThreadAction): string | null => NOT_AVAILABLE[action] ?? null;

/** What the sheet shows: the actions this conversation has switched on, in the pack's order. */
export const enabledActions = (enabled: ThreadAction[]): ThreadActionSpec[] => THREAD_ACTIONS.filter((a) => enabled.includes(a.id));

export const ACTION_ICONS: Record<ThreadAction, string> = {
  PHOTO: "image-outline", VIDEO: "videocam-outline", VOICE: "mic-outline", DOCUMENT: "document-text-outline", DESIGN: "crop-outline",
  AI_IMAGE: "sparkles-outline", LOCATION: "location-outline", CONTACT: "person-outline", POLL: "stats-chart-outline", EVENT: "calendar-outline",
  MEETING: "time-outline", LIVE_SCREEN: "phone-portrait-outline"
};

// ---- payloads -------------------------------------------------------------------------------------------------

export interface PhotoAttachment { kind: "PHOTO"; vaultId: string; width: number; height: number }
export interface DocumentAttachment { kind: "DOCUMENT"; vaultId: string; fileName: string; byteLength: number }
export interface LocationShare { kind: "LOCATION"; label: string; latitude: number; longitude: number; liveMinutes?: number }
export interface ContactShare { kind: "CONTACT"; displayName: string; handle: string }
export interface PollDraft { kind: "POLL"; question: string; options: string[]; allowsMultiple: boolean }
export interface EventDraft { kind: "EVENT"; title: string; startsAt: string; place?: string }
export interface MeetingDraft { kind: "MEETING"; title: string; startsAt: string; durationMinutes: number }
export interface VoiceNote { kind: "VOICE"; vaultId: string; durationMs: number }
export interface VideoNote { kind: "VIDEO"; vaultId: string; durationMs: number }
export interface DesignDraft { kind: "DESIGN"; vaultId: string; crop: { x: number; y: number; width: number; height: number } }
export interface AiImageDraft { kind: "AI_IMAGE"; prompt: string; vaultId?: string }
export interface LiveScreenShare { kind: "LIVE_SCREEN"; sessionId: string }

export type ThreadPayload = PhotoAttachment | DocumentAttachment | LocationShare | ContactShare | PollDraft | EventDraft | MeetingDraft | VoiceNote | VideoNote | DesignDraft | AiImageDraft | LiveScreenShare;

const NEEDS_VAULT_ID = new Set(["PHOTO", "DOCUMENT", "VOICE", "VIDEO", "DESIGN"]);

/** Throws a stable code when a payload does not fit its action. Nothing is sent when this throws. */
export function assertPayload(action: ThreadAction, payload: ThreadPayload): void {
  if (payload.kind !== action) throw new Error("THREAD_PAYLOAD_MISMATCH");
  if (payload.kind === "POLL" && payload.options.filter((o) => o.trim()).length < 2) throw new Error("POLL_NEEDS_TWO_OPTIONS");
  if (payload.kind === "LOCATION") {
    const ok = Number.isFinite(payload.latitude) && Number.isFinite(payload.longitude) && Math.abs(payload.latitude) <= 90 && Math.abs(payload.longitude) <= 180;
    if (!ok) throw new Error("LOCATION_INVALID");
  }
  if (NEEDS_VAULT_ID.has(payload.kind) && !(payload as { vaultId?: string }).vaultId) throw new Error("VAULT_ID_REQUIRED");
}

// ---- backgrounds ----------------------------------------------------------------------------------------------

/** AUTO follows the conversation theme; the others are fixed backdrops. INK is dark, the rest are light. */
export type ChatBackground = "AUTO" | "CANVAS" | "MIST" | "FOREST" | "INK";
export const BACKGROUNDS: Record<Exclude<ChatBackground, "AUTO">, string> = { CANVAS: "#E7EDF1", MIST: "#F4F1EA", FOREST: "#E5F0EC", INK: "#121820" };
export const BACKGROUND_CHOICES: Array<{ id: ChatBackground; label: string }> = [
  { id: "AUTO", label: "Auto" }, { id: "CANVAS", label: "Canvas" }, { id: "MIST", label: "Mist" }, { id: "FOREST", label: "Forest" }, { id: "INK", label: "Ink" }
];
export const isChatBackground = (value: unknown): value is ChatBackground => typeof value === "string" && BACKGROUND_CHOICES.some((b) => b.id === value);

// ---- Event and Meeting (the two actions that need nothing but a form) ------------------------------------------

/** What an event or meeting card says about when: a date and time, and for a meeting its length. */
export function cardWhen(p: { type: "event" | "meeting"; startsAt: string; place?: string; durationMinutes?: number }, locale?: string): string {
  const d = new Date(p.startsAt);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const tail = p.type === "meeting" && p.durationMinutes ? ` · ${p.durationMinutes >= 60 && p.durationMinutes % 60 === 0 ? `${p.durationMinutes / 60} h` : `${p.durationMinutes} min`}` : p.place ? ` · ${p.place}` : "";
  return `${day}, ${time}${tail}`;
}

export type CardForm = { title: string; date: string; time: string; place: string; durationMinutes: string };

/** A form that starts tomorrow at 10:00, in the phone's own time zone. */
export function defaultCardForm(now = new Date()): CardForm {
  const d = new Date(now.getTime()); d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { title: "", date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: "10:00", place: "", durationMinutes: "30" };
}

/**
 * Turns what was typed into an event or meeting payload, or says what is wrong. The date and time are read as the phone's
 * local time and stored as an exact instant. A time in the past is refused.
 */
export function buildCardPayload(kind: "EVENT" | "MEETING", form: CardForm, now = new Date()): { ok: true; payload: { type: "event"; title: string; startsAt: string; place?: string } | { type: "meeting"; title: string; startsAt: string; durationMinutes: number } } | { ok: false; error: string } {
  const title = form.title.trim();
  if (!title) return { ok: false, error: "Add a title." };
  if (title.length > 120) return { ok: false, error: "The title is too long." };
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.date.trim());
  const time = /^(\d{1,2}):(\d{2})$/.exec(form.time.trim());
  if (!date || !time) return { ok: false, error: "Use a date like 2026-10-09 and a time like 14:30." };
  const [y, mo, da] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const [h, mi] = [Number(time[1]), Number(time[2])];
  const when = new Date(y, mo - 1, da, h, mi, 0, 0);
  if (when.getFullYear() !== y || when.getMonth() !== mo - 1 || when.getDate() !== da || h > 23 || mi > 59) return { ok: false, error: "That date or time doesn't exist." };
  if (when.getTime() <= now.getTime()) return { ok: false, error: "Pick a time that hasn't passed." };
  if (kind === "EVENT") {
    const place = form.place.trim();
    if (place.length > 120) return { ok: false, error: "The place is too long." };
    return { ok: true, payload: { type: "event", title, startsAt: when.toISOString(), ...(place ? { place } : {}) } };
  }
  const minutes = Number(form.durationMinutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) return { ok: false, error: "A meeting is 5 to 480 minutes long." };
  return { ok: true, payload: { type: "meeting", title, startsAt: when.toISOString(), durationMinutes: minutes } };
}

/** The pack's sealed form of an event or meeting ({ kind: "EVENT" | "MEETING", ... }) and back. */
export function toThreadPayload(p: { type: "event"; title: string; startsAt: string; place?: string } | { type: "meeting"; title: string; startsAt: string; durationMinutes: number }): EventDraft | MeetingDraft {
  return p.type === "event" ? { kind: "EVENT", title: p.title, startsAt: p.startsAt, ...(p.place ? { place: p.place } : {}) } : { kind: "MEETING", title: p.title, startsAt: p.startsAt, durationMinutes: p.durationMinutes };
}
export function fromThreadPayload(value: unknown): { type: "event"; title: string; startsAt: string; place?: string } | { type: "meeting"; title: string; startsAt: string; durationMinutes: number } | null {
  const v = value as { kind?: string; title?: unknown; startsAt?: unknown; place?: unknown; durationMinutes?: unknown } | null;
  if (!v || typeof v.title !== "string" || typeof v.startsAt !== "string") return null;
  if (v.kind === "EVENT") return { type: "event", title: v.title, startsAt: v.startsAt, ...(typeof v.place === "string" && v.place ? { place: v.place } : {}) };
  if (v.kind === "MEETING" && typeof v.durationMinutes === "number") return { type: "meeting", title: v.title, startsAt: v.startsAt, durationMinutes: v.durationMinutes };
  return null;
}

/** Map pins for the location sheet (from the pack). Coordinates leave the phone only after accept, inside a sealed envelope. */
export interface MapPin { latitude: number; longitude: number; label: string }
export function canSendPin(pin?: MapPin): pin is MapPin {
  return !!pin && Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude) && Math.abs(pin.latitude) <= 90 && Math.abs(pin.longitude) <= 180;
}
export function regionFor(pins: MapPin[]) {
  if (pins.length === 0) return { latitude: 0, longitude: 0, latitudeDelta: 40, longitudeDelta: 40 };
  const latitude = pins.reduce((sum, pin) => sum + pin.latitude, 0) / pins.length;
  const longitude = pins.reduce((sum, pin) => sum + pin.longitude, 0) / pins.length;
  return { latitude, longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 };
}

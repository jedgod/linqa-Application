/**
 * Composer actions for the conversation thread.
 * Media bytes never sit in the page model. The sheet hands a vault id
 * or a structured payload to the core, which seals it before send.
 */

export type ThreadAction =
  | "PHOTO"
  | "LOCATION"
  | "CONTACT"
  | "DOCUMENT"
  | "POLL"
  | "EVENT"
  | "AI_IMAGE"
  | "DESIGN"
  | "LIVE_SCREEN"
  | "VOICE"
  | "VIDEO"
  | "MEETING";

export interface ThreadActionSpec {
  id: ThreadAction;
  label: string;
  group: "MEDIA" | "SHARE" | "CREATE" | "LIVE";
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
  { id: "LIVE_SCREEN", label: "Share live screen", group: "LIVE", needsConsent: true },
];

export interface PhotoAttachment {
  kind: "PHOTO";
  vaultId: string;
  width: number;
  height: number;
}

export interface DocumentAttachment {
  kind: "DOCUMENT";
  vaultId: string;
  fileName: string;
  byteLength: number;
}

export interface LocationShare {
  kind: "LOCATION";
  label: string;
  latitude: number;
  longitude: number;
  liveMinutes?: number;
}

export interface ContactShare {
  kind: "CONTACT";
  displayName: string;
  handle: string;
}

export interface PollDraft {
  kind: "POLL";
  question: string;
  options: string[];
  allowsMultiple: boolean;
}

export interface EventDraft {
  kind: "EVENT";
  title: string;
  startsAt: string;
  place?: string;
}

export interface MeetingDraft {
  kind: "MEETING";
  title: string;
  startsAt: string;
  durationMinutes: number;
}

export interface VoiceNote {
  kind: "VOICE";
  vaultId: string;
  durationMs: number;
}

export interface VideoNote {
  kind: "VIDEO";
  vaultId: string;
  durationMs: number;
}

export interface DesignDraft {
  kind: "DESIGN";
  vaultId: string;
  crop: { x: number; y: number; width: number; height: number };
}

export interface AiImageDraft {
  kind: "AI_IMAGE";
  prompt: string;
  vaultId?: string;
}

export interface LiveScreenShare {
  kind: "LIVE_SCREEN";
  sessionId: string;
}

export type ThreadPayload =
  | PhotoAttachment
  | DocumentAttachment
  | LocationShare
  | ContactShare
  | PollDraft
  | EventDraft
  | MeetingDraft
  | VoiceNote
  | VideoNote
  | DesignDraft
  | AiImageDraft
  | LiveScreenShare;

export function assertPayload(action: ThreadAction, payload: ThreadPayload): void {
  if (payload.kind !== action && !(action === "PHOTO" && payload.kind === "PHOTO")) {
    if (payload.kind !== action) throw new Error("THREAD_PAYLOAD_MISMATCH");
  }
  if (payload.kind === "POLL" && payload.options.filter((o) => o.trim()).length < 2) {
    throw new Error("POLL_NEEDS_TWO_OPTIONS");
  }
  if (payload.kind === "LOCATION") {
    if (payload.latitude < -90 || payload.latitude > 90) throw new Error("LOCATION_INVALID");
    if (payload.longitude < -180 || payload.longitude > 180) throw new Error("LOCATION_INVALID");
  }
  if ((payload.kind === "PHOTO" || payload.kind === "DOCUMENT" || payload.kind === "VOICE" || payload.kind === "VIDEO" || payload.kind === "DESIGN") && !payload.vaultId) {
    throw new Error("VAULT_ID_REQUIRED");
  }
}

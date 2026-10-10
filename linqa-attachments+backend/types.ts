/**
 * LinqaChat attachment domain.
 * Mirrors the share sheet and thread cards:
 * photos, edited photo, document, location, contact, poll,
 * event, meeting, voice, video clip, screen share, AI image.
 *
 * Encryption rule (from the share sheet and AI composer):
 * every payload is sealed on the device before send, except the AI
 * prompt, which is sent to the image service first. The chosen image
 * bytes are sealed before the recipient receives them.
 */

export type AttachmentKind =
  | "photos"
  | "document"
  | "location"
  | "contact"
  | "poll"
  | "event"
  | "meeting"
  | "voice"
  | "video"
  | "screen_share"
  | "ai_image";

export type CloseVoting = "1h" | "1d" | "never";
export type MeetingLengthMin = 15 | 30 | 45 | 60;
export type ImageStyle = "photo" | "watercolor" | "sketch" | "diagram";
export type CropRatio = "free" | "square" | "4:3" | "16:9";
export type Rsvp = "going" | "maybe" | "cant";

export interface PhotoItem {
  id: string;
  mime: string;
  width: number;
  height: number;
  bytes: ArrayBuffer;
  caption?: string;
  edits?: PhotoEdits;
}

export interface PhotoEdits {
  ratio: CropRatio;
  rotation: 0 | 90 | 180 | 270;
  drawings: Stroke[];
  captionText?: string;
  facesBlurred: boolean;
}

export interface Stroke {
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
}

export interface DocumentAttachment {
  kind: "document";
  name: string;
  mime: string;
  pageCount?: number;
  bytes: ArrayBuffer;
}

export interface LocationAttachment {
  kind: "location";
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export interface ContactAttachment {
  kind: "contact";
  name: string;
  role?: string;
  initials: string;
  phone?: string;
  handle?: string;
}

export interface PollAttachment {
  kind: "poll";
  question: string;
  options: string[];
  allowMultiple: boolean;
  hideVoters: boolean;
  closeVoting: CloseVoting;
  votes: Record<string, string[]>;
  closesAt?: string;
}

export interface EventAttachment {
  kind: "event";
  title: string;
  date: string;
  start: string;
  end: string;
  place?: string;
  rsvps: Record<string, Rsvp>;
}

export interface MeetingAttachment {
  kind: "meeting";
  title: string;
  date: string;
  starts: string;
  lengthMin: MeetingLengthMin;
  note?: string;
  remind: boolean;
  remindLeadMin: number;
  joinOpensMinBefore: number;
  callId: string;
  status: "pending" | "accepted" | "suggested";
}

export interface VoiceAttachment {
  kind: "voice";
  durationSec: number;
  mime: string;
  bytes: ArrayBuffer;
  waveform: number[];
}

export interface VideoAttachment {
  kind: "video";
  durationSec: number;
  mime: string;
  bytes: ArrayBuffer;
  poster?: ArrayBuffer;
}

export interface ScreenShareAttachment {
  kind: "screen_share";
  sessionId: string;
  startedAt: string;
  live: boolean;
  presenterName: string;
  sharedTitle?: string;
}

export interface AiImageAttachment {
  kind: "ai_image";
  prompt: string;
  style: ImageStyle;
  image: ArrayBuffer;
  mime: string;
  promptLeftDevice: true;
}

export type Attachment =
  | ({ kind: "photos" } & { items: PhotoItem[]; caption?: string })
  | DocumentAttachment
  | LocationAttachment
  | ContactAttachment
  | PollAttachment
  | EventAttachment
  | MeetingAttachment
  | VoiceAttachment
  | VideoAttachment
  | ScreenShareAttachment
  | AiImageAttachment;

export interface OutboundEnvelope {
  id: string;
  threadId: string;
  senderId: string;
  createdAt: string;
  attachment: Attachment;
  /** Ciphertext of the attachment payload. Plaintext never leaves the device. */
  sealedPayload: string;
  /** AI prompts are the only field that may be sent unsealed, and only to the image service. */
  cleartextException?: "ai_prompt";
}

export const SHARE_ACTIONS: Array<{
  kind: AttachmentKind | "edit_photo";
  label: string;
  hint: string;
}> = [
  { kind: "photos", label: "Photos", hint: "Album or single site photo" },
  { kind: "edit_photo", label: "Edit photo", hint: "Crop, draw, text, blur faces" },
  { kind: "document", label: "Document", hint: "PDF and files, page count on the card" },
  { kind: "location", label: "Location", hint: "Pin, label, open in maps" },
  { kind: "contact", label: "Contact", hint: "Name, role, message or save" },
  { kind: "poll", label: "Poll", hint: "Question, answers, close window" },
  { kind: "event", label: "Event", hint: "Walkthrough with going / maybe / can't" },
  { kind: "meeting", label: "Meeting", hint: "Encrypted Linqa call invite" },
  { kind: "voice", label: "Voice", hint: "Listen before send, sealed on device" },
  { kind: "video", label: "Video clip", hint: "Short clip with duration badge" },
  { kind: "screen_share", label: "Share screen", hint: "Live encrypted view" },
  { kind: "ai_image", label: "AI image", hint: "Prompt leaves device; chosen image is sealed" },
];

/**
 * Linqa call protocol. Keep this file identical in:
 *   server/src/calls/calls.protocol.ts
 *   mobile/src/calls/protocol.ts
 *
 * Design rules:
 *  - The server routes and tracks membership only. It never sees SDP, ICE,
 *    hand raises, board strokes or media. Those travel as MLS ciphertext
 *    (signaling) or over the WebRTC data channel (DTLS, peer to peer).
 *  - A participant is one device: participantId = `${userId}:${deviceId}`.
 */

export type CallKind = 'voice' | 'video';

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface ParticipantInfo {
  participantId: string;
  userId: string;
  deviceId: string;
  joinedAt: number;
}

export interface CallSummary {
  callId: string;
  conversationId: string;
  kind: CallKind;
  /** MLS group created for this call only. Signaling is encrypted to it. */
  mlsGroupId: string;
  createdBy: string;
  createdAt: number;
  participants: ParticipantInfo[];
  iceServers: IceServer[];
}

export interface TransferState {
  muted: boolean;
  cameraOn: boolean;
}

export interface DeviceInfo {
  deviceId: string;
  name: string;
  platform: 'ios' | 'android' | 'desktop' | 'web' | 'unknown';
}

/* ---------- client -> server events ---------- */

export const C2S = {
  create: 'call:create',
  join: 'call:join',
  decline: 'call:decline',
  leave: 'call:leave',
  signal: 'call:signal',
  invite: 'call:invite',
  devices: 'call:devices',
  handoffOffer: 'call:handoff:offer',
  handoffAccept: 'call:handoff:accept',
  handoffCancel: 'call:handoff:cancel',
} as const;

export interface CreateCallReq {
  conversationId: string;
  kind: CallKind;
  mlsGroupId: string;
  inviteeUserIds: string[];
}
export interface JoinCallReq { callId: string }
export interface DeclineCallReq { callId: string }
export interface LeaveCallReq { callId: string }
export interface SignalReq {
  callId: string;
  to: string; // participantId
  ciphertext: string; // base64 MLS application message
}
export interface InviteReq { callId: string; userIds: string[] }
export interface DevicesReq { callId: string }
export interface HandoffOfferReq { callId: string; toDeviceId: string; transferState: TransferState }
export interface HandoffOfferRes { token: string; expiresAt: number }
export interface HandoffAcceptReq { callId: string; token: string }
export interface HandoffAcceptRes { call: CallSummary; transferState: TransferState }
export interface HandoffCancelReq { callId: string; token: string }

/* ---------- server -> client events ---------- */

export const S2C = {
  ring: 'call:ring',
  ringCancelled: 'call:ring-cancelled',
  declined: 'call:declined',
  participantJoined: 'call:participant-joined',
  participantLeft: 'call:participant-left',
  signal: 'call:signal',
  ended: 'call:ended',
  handoffIncoming: 'call:handoff:incoming',
  handoffCancelled: 'call:handoff:cancelled',
  handoffCompleted: 'call:handoff:completed',
} as const;

export interface RingEvt {
  callId: string;
  conversationId: string;
  kind: CallKind;
  mlsGroupId: string;
  fromUserId: string;
}
export interface RingCancelledEvt { callId: string; reason: 'answered-elsewhere' | 'ended' | 'timeout' }
export interface DeclinedEvt { callId: string; userId: string }
export interface ParticipantJoinedEvt {
  callId: string;
  participant: ParticipantInfo;
  /** Set when this join is a device switch. Close the old peer connection. */
  replaces?: string;
}
export interface ParticipantLeftEvt { callId: string; participantId: string }
export interface SignalEvt { callId: string; from: string; ciphertext: string }
export type EndReason = 'hangup' | 'no-answer' | 'declined' | 'empty' | 'error';
export interface EndedEvt { callId: string; reason: EndReason }
export interface HandoffIncomingEvt {
  callId: string;
  token: string;
  fromDeviceId: string;
  fromDeviceName: string;
  kind: CallKind;
  /** Wait for this MLS group's Welcome before accepting. */
  mlsGroupId: string;
  expiresAt: number;
}
export interface HandoffCancelledEvt { callId: string; token: string }
export interface HandoffCompletedEvt { callId: string; toDeviceId: string }

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

/* ---------- call info (REST) ---------- */

export interface CallInfoRes {
  callId: string;
  kind: CallKind;
  createdAt: number;
  /** When the second person joined. Duration counts from here. */
  answeredAt: number | null;
  endedAt: number | null;
  durationMs: number;
  participantCount: number;
  maxParticipants: number;
}

/* ---------- reports (REST) ---------- */

export const REPORT_REASONS = [
  'harassment',
  'spam',
  'sexual-content',
  'violence',
  'impersonation',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface CreateReportBody {
  reportedUserIds: string[];
  reason: ReportReason;
  note?: string;
}

export const LIMITS = {
  maxParticipants: 8, // mesh topology; move to an SFU with SFrame above this
  maxSignalBytes: 64 * 1024,
  ringTimeoutMs: 45_000,
  handoffTtlMs: 60_000,
  reconnectGraceMs: 20_000,
  reportNoteMax: 1000,
  endedCallRetentionMs: 7 * 24 * 60 * 60 * 1000,
} as const;

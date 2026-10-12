/**
 * Linqa call protocol. Keep this file identical in:
 *   server/src/calls/calls.protocol.ts
 *   mobile/src/calls/protocol.ts
 *
 * Design rules:
 *  - The server routes and tracks membership only. It never sees SDP, ICE,
 *    hand raises, board strokes or media. Signaling is encrypted with a
 *    per-call key (linqa-core: X25519 + ML-KEM-768 sealed, XChaCha20-Poly1305,
 *    Ed25519-signed). Everything else rides the WebRTC data channel.
 *  - The call key reaches each device inside a KeyEnvelope sealed to that
 *    device's public keys. The server forwards envelopes and cannot open them.
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
  /** Id of the per-call key. The key itself never reaches the server. */
  keyId: string;
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

/** The call key sealed to one device. Opaque to the server. */
export interface KeyEnvelope {
  userId: string;
  deviceId: string;
  envelope: string; // base64
}

export interface CreateCallReq {
  conversationId: string;
  kind: CallKind;
  keyId: string;
  inviteeUserIds: string[];
  /** One per invitee device. Devices without one are not rung. */
  keyEnvelopes: KeyEnvelope[];
}
export interface JoinCallReq { callId: string }
export interface DeclineCallReq { callId: string }
export interface LeaveCallReq { callId: string }
export interface SignalReq {
  callId: string;
  to: string; // participantId
  ciphertext: string; // base64, encrypted + signed with the call key
}
export interface InviteReq { callId: string; userIds: string[]; keyEnvelopes: KeyEnvelope[] }
export interface DevicesReq { callId: string }
export interface HandoffOfferReq {
  callId: string;
  toDeviceId: string;
  transferState: TransferState;
  /** The call key sealed to the target device. */
  keyEnvelope: string;
}
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
  keyId: string;
  fromUserId: string;
  fromDeviceId: string;
  /** The call key sealed to the receiving device. */
  keyEnvelope: string;
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
  keyId: string;
  /** The call key sealed to this device by your other device. */
  keyEnvelope: string;
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
  maxEnvelopeBytes: 8 * 1024,
  maxEnvelopesPerRequest: 64,
  ringTimeoutMs: 45_000,
  handoffTtlMs: 60_000,
  reconnectGraceMs: 20_000,
  reportNoteMax: 1000,
  endedCallRetentionMs: 7 * 24 * 60 * 60 * 1000,
} as const;

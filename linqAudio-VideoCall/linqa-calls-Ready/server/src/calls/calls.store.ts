import { Injectable } from '@nestjs/common';
import { CallKind, EndReason, TransferState } from './calls.protocol';

export interface ParticipantRecord {
  participantId: string;
  userId: string;
  deviceId: string;
  joinedAt: number;
  /** Set while the socket is gone; cleared on reconnect-join. */
  disconnectedAt?: number;
}

export interface CallRecord {
  callId: string;
  conversationId: string;
  kind: CallKind;
  keyId: string;
  createdBy: string;
  createdAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
  participants: Map<string, ParticipantRecord>;
  /** userIds currently ringing. */
  invited: Set<string>;
  /** userIds that were ever connected. Used for info access and reports. */
  everJoined: Set<string>;
  /** userIds that were ever rung. Used for info access. */
  everInvited: Set<string>;
  /** Sealed call keys for rung devices, `${userId}:${deviceId}` -> envelope, plus who sealed it. */
  envelopes: Map<string, { envelope: string; fromUserId: string; fromDeviceId: string }>;
}

export interface HandoffRecord {
  token: string;
  callId: string;
  userId: string;
  fromParticipantId: string;
  fromDeviceId: string;
  toDeviceId: string;
  transferState: TransferState;
  keyEnvelope: string;
  expiresAt: number;
}

/**
 * In-memory call state. One API instance only. For several instances,
 * swap for a Redis-backed store with the same methods and use the
 * socket.io Redis adapter so emits reach every node.
 */
@Injectable()
export class CallsStore {
  private calls = new Map<string, CallRecord>();
  private handoffs = new Map<string, HandoffRecord>();

  get(callId: string): CallRecord | undefined {
    return this.calls.get(callId);
  }

  put(call: CallRecord): void {
    this.calls.set(call.callId, call);
  }

  delete(callId: string): void {
    this.calls.delete(callId);
  }

  all(): IterableIterator<CallRecord> {
    return this.calls.values();
  }

  activeCallsForDevice(userId: string, deviceId: string): CallRecord[] {
    const out: CallRecord[] = [];
    for (const c of this.calls.values()) {
      if (c.endedAt) continue;
      for (const p of c.participants.values()) {
        if (p.userId === userId && p.deviceId === deviceId) out.push(c);
      }
    }
    return out;
  }

  putHandoff(h: HandoffRecord): void {
    this.handoffs.set(h.token, h);
  }

  getHandoff(token: string): HandoffRecord | undefined {
    return this.handoffs.get(token);
  }

  deleteHandoff(token: string): void {
    this.handoffs.delete(token);
  }

  /** Active calls where this user is still ringing. */
  ringingFor(userId: string): CallRecord[] {
    return [...this.calls.values()].filter((c) => !c.endedAt && c.invited.has(userId));
  }

  handoffsForCall(callId: string): HandoffRecord[] {
    return [...this.handoffs.values()].filter((h) => h.callId === callId);
  }
}

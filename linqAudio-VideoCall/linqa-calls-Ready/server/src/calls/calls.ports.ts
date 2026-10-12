/**
 * Seams to the rest of the Linqa API. Bind these to your existing auth,
 * conversation and push code in AppModule (see calls.module.ts).
 */
import { DeviceInfo } from './calls.protocol';

export interface AuthContext {
  userId: string;
  deviceId: string;
  deviceName: string;
  platform: DeviceInfo['platform'];
}

/** Sent next to the token: socket handshake `auth`, or X-Device-* headers over HTTP. */
export interface DeviceClaim {
  deviceId?: string;
  deviceName?: string;
  platform?: string;
}

export const AUTH_VERIFIER = Symbol('AUTH_VERIFIER');
export interface AuthVerifier {
  /**
   * Verify the JWT and that the claimed device belongs to that user.
   * Return null when either check fails.
   */
  verify(token: string, device: DeviceClaim): Promise<AuthContext | null>;
}

export const CONVERSATIONS_PORT = Symbol('CONVERSATIONS_PORT');
export interface ConversationsPort {
  isMember(conversationId: string, userId: string): Promise<boolean>;
  /** False if either side has blocked the other, or they are not contacts. */
  canCall(fromUserId: string, toUserId: string): Promise<boolean>;
}

export const RING_NOTIFIER = Symbol('RING_NOTIFIER');
export interface RingNotifier {
  /**
   * Called for every ring. Send a VoIP push (PushKit / FCM high priority)
   * so devices without an open socket can show the system call UI.
   * The payload must not include anything beyond ids and call kind.
   */
  ring(
    userId: string,
    deviceIds: string[],
    payload: { callId: string; kind: string; fromUserId: string },
  ): Promise<void>;
  cancel(userId: string, callId: string): Promise<void>;
}

export class NoopRingNotifier implements RingNotifier {
  async ring(): Promise<void> {}
  async cancel(): Promise<void> {}
}

/** Delivery seam implemented by the socket gateway. Lets the service be unit tested. */
export const CALL_EMITTER = Symbol('CALL_EMITTER');
export interface CallEmitter {
  toUser(userId: string, event: string, payload: unknown, opts?: { exceptDeviceId?: string }): void;
  toDevice(userId: string, deviceId: string, event: string, payload: unknown): void;
  onlineDevices(userId: string): DeviceInfo[];
}

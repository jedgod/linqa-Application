import { io, Socket } from 'socket.io-client';
import { Ack, C2S, S2C } from './protocol';
import type { CallSession } from './ports';

type Handler = (payload: any) => void;

/** Thin socket.io wrapper. Every request resolves with data or throws the server's error code. */
export class SignalingClient {
  private socket: Socket;
  private handlers = new Map<string, Set<Handler>>();

  constructor(session: CallSession) {
    this.socket = io(`${session.apiBaseUrl}/calls`, {
      transports: ['websocket'],
      auth: (cb) => {
        session.getToken().then((token) => cb({ token }), () => cb({ token: '' }));
      },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    for (const evt of Object.values(S2C)) {
      this.socket.on(evt, (p: unknown) => this.handlers.get(evt)?.forEach((h) => h(p)));
    }
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  onReconnect(fn: () => void): () => void {
    this.socket.io.on('reconnect', fn);
    return () => this.socket.io.off('reconnect', fn);
  }

  on(event: (typeof S2C)[keyof typeof S2C], fn: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  async request<T>(event: (typeof C2S)[keyof typeof C2S], payload: unknown, timeoutMs = 10_000): Promise<T> {
    const ack = (await this.socket.timeout(timeoutMs).emitWithAck(event, payload)) as Ack<T>;
    if (!ack.ok) throw new CallRequestError(ack.error);
    return ack.data;
  }

  close(): void {
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}

export class CallRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Human text for server error codes shown in the UI. */
export function errorText(code: string): string {
  const map: Record<string, string> = {
    'call-full': 'This call is full.',
    'cannot-call-user': "You can't call this person.",
    'device-offline': 'That device is offline.',
    'handoff-expired': 'The switch timed out. Try again.',
    'in-call-on-other-device': "You're already in this call on another device. Use Switch device.",
    'call-ended': 'The call has ended.',
    'already-reported': "You've already reported this.",
  };
  return map[code] ?? 'Something went wrong. Try again.';
}

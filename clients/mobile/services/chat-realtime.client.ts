/**
 * WebSocket client for chat realtime.
 *
 * The app has never had one: every screen polled or refreshed on focus. This
 * connects to the same `/v1/realtime` socket the server already authenticates
 * and adds the chat protocol on top -- subscriptions, typing, and durable
 * event delivery.
 *
 * Two things it deliberately does not do:
 *
 *  - It does not treat the socket as the source of truth. Frames can be
 *    missed; the durable record is `chat_outbox`, replayed over HTTP from the
 *    greatest `eventId` seen. A dropped frame costs a refresh, never a message.
 *  - It does not fabricate presence. A typing indicator expires on its own
 *    timer, so a peer who backgrounds the app mid-sentence stops "typing"
 *    without the server having to say so.
 */

export type ChatRealtimeEvent =
  | { type: "conversation.created"; conversationId: string }
  | { type: "message.created"; eventId: number; conversationId: string; payload: unknown }
  | { type: "conversation.read"; eventId: number; conversationId: string; payload: unknown }
  | { type: "typing.start"; conversationId: string; userId: string; expiresInSeconds: number }
  | { type: "typing.stop"; conversationId: string; userId: string };

type Listener = (event: ChatRealtimeEvent) => void;

type ReactNativeWebSocket = new (
  url: string,
  protocols?: string | string[] | undefined,
  options?: { headers?: Record<string, string> }
) => WebSocket;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEARTBEAT_MS = 25_000;

export class ChatRealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private conversationIds: string[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Greatest durable event id seen, so a reconnect can ask for the gap. */
  private lastEventId = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get cursor(): number {
    return this.lastEventId;
  }

  /** Conversations to watch. Safe to call repeatedly as the inbox changes. */
  setConversations(conversationIds: string[]): void {
    this.conversationIds = conversationIds;
    this.sendSubscribe();
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.reconnectTimer = null;
    this.heartbeat = null;
    this.socket?.close();
    this.socket = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.socket) return;
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch {
      // No session yet. Retry rather than give up: the user may be mid-login.
      this.scheduleReconnect();
      return;
    }

    const url = `${this.baseUrl.replace(/^http/, "ws")}/v1/realtime`;
    // React Native's WebSocket takes a third options argument that the DOM
    // lib's type does not describe. The token goes in a header rather than the
    // query string, where proxies and access logs would record it.
    const socket = new (WebSocket as unknown as ReactNativeWebSocket)(url, undefined, {
      headers: { authorization: `Bearer ${token}` }
    });
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.sendSubscribe();
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, HEARTBEAT_MS);
    };

    socket.onmessage = (message) => this.ingest(String(message.data));

    socket.onerror = () => {
      // `onclose` always follows; reconnecting here too would double-schedule.
    };

    socket.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    // Backoff with jitter: a server restart must not bring every client back
    // in the same millisecond.
    const delay =
      Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt) + Math.random() * 500;
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 6);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private sendSubscribe(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.conversationIds.length === 0) return;
    this.socket.send(
      JSON.stringify({ type: "subscribe", conversationIds: this.conversationIds.slice(0, 100) })
    );
  }

  sendTyping(conversationId: string, typing: boolean): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: typing ? "typing.start" : "typing.stop", conversationId }));
  }

  private ingest(raw: string): void {
    if (raw === "pong") return;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = frame.type;
    if (typeof type !== "string") return;
    // Server acknowledgements and the pre-existing envelope signal are not
    // chat events; ignoring them keeps listeners simple.
    if (type === "ready" || type === "subscribed" || type === "presence.ack" || type === "error") return;

    if (typeof frame.eventId === "number" && frame.eventId > this.lastEventId) {
      this.lastEventId = frame.eventId;
    }
    for (const listener of this.listeners) listener(frame as unknown as ChatRealtimeEvent);
  }
}

/**
 * Tracks who is typing where, with self-expiry.
 *
 * The indicator is removed on a timer rather than only on a "stop" frame,
 * because the frame that would clear it is exactly the one a dropped
 * connection loses -- and a peer shown as permanently typing is worse than no
 * indicator at all.
 */
export class TypingRegistry {
  private readonly entries = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly onChange: (conversationIds: Set<string>) => void) {}

  start(conversationId: string, ttlSeconds: number): void {
    const existing = this.entries.get(conversationId);
    if (existing) clearTimeout(existing);
    this.entries.set(
      conversationId,
      setTimeout(() => {
        this.entries.delete(conversationId);
        this.emit();
      }, Math.max(1, ttlSeconds) * 1000)
    );
    this.emit();
  }

  stop(conversationId: string): void {
    const existing = this.entries.get(conversationId);
    if (!existing) return;
    clearTimeout(existing);
    this.entries.delete(conversationId);
    this.emit();
  }

  clear(): void {
    for (const timer of this.entries.values()) clearTimeout(timer);
    this.entries.clear();
  }

  private emit(): void {
    this.onChange(new Set(this.entries.keys()));
  }
}

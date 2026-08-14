export class RealtimeClient {
  private socket: WebSocket | null = null;
  private retryAttempt = 0;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly getAccessToken: () => Promise<string>,
    private readonly onEnvelopeAvailable: (sequence: number) => void
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close(1000, "client shutdown");
    this.socket = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const token = await this.getAccessToken();
    const url = new URL(this.url);
    url.searchParams.set("access_token", token);

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.retryAttempt = 0;
    };

    socket.onmessage = (event) => {
      if (event.data === "pong") return;
      try {
        const message = JSON.parse(String(event.data));
        if (
          message.type === "envelope.available" &&
          Number.isSafeInteger(message.serverSequence)
        ) {
          this.onEnvelopeAvailable(message.serverSequence);
        }
      } catch {
        // Ignore malformed server events.
      }
    };

    socket.onclose = () => {
      this.socket = null;
      if (!this.stopped) this.scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    const delay = Math.min(30_000, 500 * 2 ** this.retryAttempt);
    const jitter = Math.floor(Math.random() * 250);
    this.retryAttempt += 1;
    window.setTimeout(() => void this.connect(), delay + jitter);
  }
}

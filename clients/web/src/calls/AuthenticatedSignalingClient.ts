export interface SignalingCryptoCore {
  encryptSignalingEvent(input: {
    callId: string;
    recipientDeviceId: string;
    sequence: number;
    eventType: string;
    payload: unknown;
  }): Promise<Uint8Array>;
  decryptSignalingEvent(ciphertext: Uint8Array): Promise<unknown>;
}

export class AuthenticatedSignalingClient {
  private socket: WebSocket | null = null;
  private nextSequence = 1;
  private lastReceivedSequence = 0;

  constructor(
    private readonly url: string,
    private readonly getAccessToken: () => Promise<string>,
    private readonly cryptoCore: SignalingCryptoCore
  ) {}

  async connect(callId: string): Promise<void> {
    const token = await this.getAccessToken();
    const url = new URL(this.url);
    url.searchParams.set("callId", callId);
    url.searchParams.set("access_token", token);

    this.socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      if (!this.socket) return reject(new Error("socket unavailable"));
      this.socket.onopen = () => resolve();
      this.socket.onerror = () => reject(new Error("signaling connection failed"));
    });
  }

  async send(input: {
    callId: string;
    recipientDeviceId: string;
    eventType:
      | "OFFER"
      | "ANSWER"
      | "ICE_CANDIDATE"
      | "ICE_COMPLETE"
      | "CALL_ACCEPTED"
      | "CALL_REJECTED"
      | "CALL_ENDED"
      | "RESUME";
    payload: unknown;
  }) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("signaling socket is not connected");
    }

    const sequence = this.nextSequence++;
    const ciphertext = await this.cryptoCore.encryptSignalingEvent({
      callId: input.callId,
      recipientDeviceId: input.recipientDeviceId,
      sequence,
      eventType: input.eventType,
      payload: input.payload
    });

    this.socket.send(JSON.stringify({
      callId: input.callId,
      recipientDeviceId: input.recipientDeviceId,
      sequence,
      eventType: input.eventType,
      ciphertextBase64: this.toBase64(ciphertext)
    }));
  }

  acceptSequence(sequence: number): boolean {
    if (!Number.isSafeInteger(sequence) || sequence <= this.lastReceivedSequence) {
      return false;
    }
    this.lastReceivedSequence = sequence;
    return true;
  }

  private toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}

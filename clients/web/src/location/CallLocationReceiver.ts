import type { RawLocation } from "./LocationPrivacy";

export interface LocationDecryptionCore {
  decryptCallLocation(input: {
    callId: string;
    ciphertext: Uint8Array;
  }): Promise<RawLocation>;
}

export interface ReceivedCallLocation extends RawLocation {
  sequence: number;
  senderDeviceId: string;
  capturedAt: string;
  expiresAt: string;
}

/**
 * Receiving side of call location sharing. LocationExchangeService only
 * publishes; nothing previously read a shared location back for display.
 * Viewing is opt-in: poll() throws until accept() has been called, so a UI
 * component can require an explicit "show location" action before any
 * decryption happens.
 */
export class CallLocationReceiver {
  private accepted = false;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>,
    private readonly cryptoCore: LocationDecryptionCore
  ) {}

  accept(): void {
    this.accepted = true;
  }

  decline(): void {
    this.accepted = false;
  }

  isAccepted(): boolean {
    return this.accepted;
  }

  async poll(callId: string, afterSequence = 0): Promise<ReceivedCallLocation[]> {
    if (!this.accepted) {
      throw new Error("Viewing shared location requires explicit acceptance first.");
    }

    const token = await this.getAccessToken();
    const response = await fetch(
      `${this.apiBaseUrl}/v1/calls/${callId}/location-events?afterSequence=${afterSequence}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (!response.ok) throw new Error("Unable to fetch shared location.");

    const payload = (await response.json()) as {
      events: Array<{
        sequence: number;
        senderDeviceId: string;
        ciphertextBase64: string;
        capturedAt: string;
        expiresAt: string;
      }>;
    };

    const decrypted: ReceivedCallLocation[] = [];
    for (const event of payload.events) {
      if (new Date(event.expiresAt).getTime() <= Date.now()) continue;

      const position = await this.cryptoCore.decryptCallLocation({
        callId,
        ciphertext: this.fromBase64(event.ciphertextBase64)
      });

      decrypted.push({
        sequence: event.sequence,
        senderDeviceId: event.senderDeviceId,
        capturedAt: event.capturedAt,
        expiresAt: event.expiresAt,
        ...position
      });
    }
    return decrypted;
  }

  private fromBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
}

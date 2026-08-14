import {
  assertLocationConsent,
  reduceLocationPrecision,
  type LocationMode
} from "./LocationPrivacy";

export interface LocationCryptoCore {
  encryptCallLocation(input: {
    callId: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    capturedAt: string;
    expiresAt: string;
  }): Promise<Uint8Array>;
}

export class LocationExchangeService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>,
    private readonly cryptoCore: LocationCryptoCore
  ) {}

  async publish(input: {
    callId: string;
    mode: LocationMode;
    granted: boolean;
    callActive: boolean;
    foreground: boolean;
    foregroundOnly: boolean;
    grantExpiresAt: string;
    location: GeolocationPosition;
  }) {
    assertLocationConsent({
      granted: input.granted,
      callActive: input.callActive,
      foreground: input.foreground,
      foregroundOnly: input.foregroundOnly,
      expiresAt: input.grantExpiresAt
    });

    const reduced = reduceLocationPrecision(
      {
        latitude: input.location.coords.latitude,
        longitude: input.location.coords.longitude,
        accuracyMeters: input.location.coords.accuracy
      },
      input.mode
    );

    const capturedAt = new Date().toISOString();
    const expiresAt = new Date(
      Math.min(
        new Date(input.grantExpiresAt).getTime(),
        Date.now() + 2 * 60 * 1000
      )
    ).toISOString();

    const ciphertext = await this.cryptoCore.encryptCallLocation({
      callId: input.callId,
      ...reduced,
      capturedAt,
      expiresAt
    });

    const token = await this.getAccessToken();
    const response = await fetch(
      `${this.apiBaseUrl}/v1/calls/${input.callId}/location-events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ciphertextBase64: this.toBase64(ciphertext),
          capturedAt,
          expiresAt
        })
      }
    );

    if (!response.ok) throw new Error("Unable to publish encrypted location.");
  }

  private toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}

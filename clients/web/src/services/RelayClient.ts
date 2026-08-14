export interface RelayEnvelopeInput {
  recipientDeviceId: string;
  clientMessageId: string;
  ciphertext: Uint8Array;
  expiresAt?: string;
}

export interface AcceptedEnvelope {
  envelopeId: string;
  serverSequence: number;
  acceptedAt: string;
  idempotentReplay: boolean;
}

import type { TransparencyInclusionProof } from "../security/TransparencyVerifier";

export class RelayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {})
      }
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        payload && typeof payload.error === "string"
          ? payload.error
          : `http_${response.status}`;
      throw new Error(`Relay request failed: ${code}`);
    }
    return payload as T;
  }

  async submitEnvelope(input: RelayEnvelopeInput): Promise<AcceptedEnvelope> {
    if (input.ciphertext.byteLength < 16) {
      throw new Error("Ciphertext is invalid or empty.");
    }

    return this.request<AcceptedEnvelope>("/v1/relay/envelopes", {
      method: "POST",
      body: JSON.stringify({
        recipientDeviceId: input.recipientDeviceId,
        clientMessageId: input.clientMessageId,
        ciphertextBase64: this.toBase64(input.ciphertext),
        expiresAt: input.expiresAt
      })
    });
  }

  async sendEnvelope(input: RelayEnvelopeInput): Promise<AcceptedEnvelope> {
    return this.submitEnvelope(input);
  }

  async publishKeyPackage(deviceId: string, packageBytes: Uint8Array) {
    const parsed = JSON.parse(new TextDecoder().decode(packageBytes)) as {
      version: number;
      expires_at_unix: number;
    };
    return this.request<{ id: string; packageHash: string; transparencySequence: number }>(
      `/v1/devices/${encodeURIComponent(deviceId)}/key-package`,
      {
        method: "PUT",
        body: JSON.stringify({
          packageVersion: parsed.version,
          packageBase64: this.toBase64(packageBytes),
          expiresAt: new Date(parsed.expires_at_unix * 1000).toISOString()
        })
      }
    );
  }

  async keyPackages(userId: string) {
    return this.request<{
      keyPackages: Array<{
        id: string;
        deviceId: string;
        packageVersion: number;
        packageBase64: string;
        packageHash: string;
        expiresAt: string;
        createdAt: string;
        transparencyProof?: TransparencyInclusionProof;
      }>;
    }>(`/v1/users/${encodeURIComponent(userId)}/key-packages`, { method: "GET" });
  }

  async receive(limit = 100) {
    return this.request<{
      leaseOwner: string;
      leaseExpiresInSeconds: number;
      envelopes: Array<{
        id: string;
        senderDeviceId: string;
        senderSigningPublicKeyBase64: string;
        clientMessageId: string;
        ciphertextBase64: string;
        serverSequence: number;
        acceptedAt: string;
        expiresAt: string;
      }>;
    }>(`/v1/relay/envelopes?limit=${encodeURIComponent(limit)}`, {
      method: "GET"
    });
  }

  async acknowledge(leaseOwner: string, envelopeIds: string[]) {
    if (envelopeIds.length === 0) return { acknowledged: 0 };

    return this.request<{ acknowledged: number }>(
      "/v1/relay/acknowledgements",
      {
        method: "POST",
        body: JSON.stringify({ leaseOwner, envelopeIds })
      }
    );
  }

  private toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}

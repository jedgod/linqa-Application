export class LinqaVerticalSliceClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  async publishKeyPackage(input: {
    deviceId: string;
    packageVersion: number;
    packageBytes: Uint8Array;
    expiresAt: string;
  }) {
    return this.request(`/v1/devices/${input.deviceId}/key-package`, {
      method: "PUT",
      body: JSON.stringify({
        packageVersion: input.packageVersion,
        packageBase64: this.toBase64(input.packageBytes),
        expiresAt: input.expiresAt
      })
    });
  }

  async getKeyPackages(userId: string) {
    return this.request(`/v1/users/${userId}/key-packages`, {
      method: "GET"
    });
  }

  async sendEnvelope(input: {
    recipientDeviceId: string;
    clientMessageId: string;
    ciphertext: Uint8Array;
    expiresAt?: string;
  }) {
    return this.request("/v1/relay/envelopes", {
      method: "POST",
      body: JSON.stringify({
        recipientDeviceId: input.recipientDeviceId,
        clientMessageId: input.clientMessageId,
        ciphertextBase64: this.toBase64(input.ciphertext),
        expiresAt: input.expiresAt
      })
    });
  }

  async receive(limit = 100) {
    return this.request(`/v1/relay/envelopes?limit=${limit}`, {
      method: "GET"
    });
  }

  async acknowledge(leaseOwner: string, envelopeIds: string[]) {
    return this.request("/v1/relay/acknowledgements", {
      method: "POST",
      body: JSON.stringify({ leaseOwner, envelopeIds })
    });
  }

  private async request(path: string, init: RequestInit) {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {})
      }
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error ?? `HTTP ${response.status}`);
    }
    return payload;
  }

  private toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
}

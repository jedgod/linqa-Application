/**
 * Adapted from the Milestone 3 pack's Milestone3Client.ts (2026-08-07 apply
 * pass): the pack assumed a shared `ApiClient` abstraction that doesn't
 * exist anywhere in this client. Every other mobile service
 * (calls.service.ts, media.service.ts, ...) uses a plain
 * (apiBaseUrl, getAccessToken) constructor instead, so this follows that
 * existing convention rather than introducing a second one.
 */
export class Milestone3Service {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { "content-type": "application/json" } : {})
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {})
    });

    if (!response.ok) {
      throw new Error(`Milestone 3 request failed (${response.status}).`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  devices() {
    return this.request<{ devices: any[] }>("/v3/devices");
  }

  approveDevice(deviceId: string) {
    return this.request<void>(`/v3/devices/${deviceId}/approve`, {
      method: "POST",
      body: { coreVerified: true }
    });
  }

  keyTransparency() {
    return this.request<{ devices: any[] }>("/v3/key-transparency");
  }

  turnCredentials() {
    return this.request<{
      region: string;
      urls: string[];
      username: string;
      credential: string;
      expiresAt: number;
    }>("/v3/turn/credentials");
  }

  attachmentDownload(deliveryId: string) {
    return this.request<{ url: string }>(`/v3/attachments/${deliveryId}/download`);
  }
}

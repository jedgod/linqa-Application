/** Adapted from the Multi-Account pack's MultiAccountClient.ts — see milestone3.service.ts for why. */
export class MultiAccountApiService {
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
      throw new Error(`Multi-account request failed (${response.status}).`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  registerInstallation(installationPublicId: string, platform: "IOS" | "ANDROID" | "WEB" | "WINDOWS" | "MACOS" | "LINUX") {
    return this.request<{ id: string; trust_state: string }>("/v5/installations", {
      method: "POST",
      body: { installationPublicId, platform }
    });
  }

  accounts(installationId: string) {
    return this.request<{ accounts: any[] }>(`/v5/installations/${installationId}/accounts`);
  }

  addAuthenticatedAccount(installationId: string, label?: string) {
    return this.request<{ userId: string; accountSlot: number }>(`/v5/installations/${installationId}/accounts`, {
      method: "POST",
      body: { label }
    });
  }

  switchAccount(installationId: string, toUserId: string) {
    return this.request<{ accessToken: string; refreshToken: string; sessionId: string; expiresAt: string }>(
      `/v5/installations/${installationId}/switch`,
      { method: "POST", body: { toUserId } }
    );
  }

  removeAccount(installationId: string, userId: string) {
    return this.request<void>(`/v5/installations/${installationId}/accounts/${userId}`, { method: "DELETE" });
  }
}

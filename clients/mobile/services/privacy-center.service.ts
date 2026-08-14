export type PrivacySummary = {
  privacyScore: number;
  secureCoreReady: boolean;
  blockedCount: number;
  devices: Array<{
    id: string;
    deviceName: string;
    platform: string;
    status: string;
    registeredAt?: string;
    lastSeenAt?: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
  }>;
  sessions: Array<{
    id: string;
    createdAt: string;
    revokedAt?: string;
  }>;
};

export type DeviceAlert = {
  id: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  createdAt: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
};

export class PrivacyCenterService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>,
  ) {}

  async summary(): Promise<PrivacySummary> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}/v1/privacy-center`, {
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Unable to load Privacy Center (${response.status}).`);
    }

    const payload = await response.json();

    return {
      privacyScore: payload.privacyScore ?? 0,
      secureCoreReady: payload.secureCoreReady === true,
      blockedCount: payload.blockedUsers?.length ?? 0,
      devices: (payload.devices ?? []).map((item: any) => ({
        id: item.id,
        deviceName: item.device_name,
        platform: item.platform,
        status: item.status,
        registeredAt: item.registered_at ?? undefined,
        lastSeenAt: item.last_seen_at ?? undefined,
        riskLevel: (item.status === "ACTIVE" ? "LOW" : item.status === "PENDING" ? "MEDIUM" : "HIGH") as
          | "LOW"
          | "MEDIUM"
          | "HIGH",
      })),
      sessions: (payload.sessions ?? []).map((item: any) => ({
        id: item.id,
        createdAt: item.created_at,
        revokedAt: item.revoked_at,
      })),
    };
  }

  async alerts(): Promise<DeviceAlert[]> {
    const payload = await this.request<{ alerts: any[] }>("/v1/security/device-alerts");
    return payload.alerts.map((item) => ({
      id: item.id,
      deviceId: item.device_id,
      deviceName: item.device_name ?? "Unknown device",
      platform: item.platform ?? "UNKNOWN",
      createdAt: item.created_at,
      riskLevel: item.risk_level ?? "MEDIUM"
    }));
  }

  acknowledgeAlert(alertId: string): Promise<void> {
    return this.request(`/v1/security/device-alerts/${alertId}/acknowledge`, { method: "POST" });
  }

  revokeDevice(deviceId: string): Promise<void> {
    return this.request(`/v3/devices/${deviceId}`, { method: "DELETE" });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init.headers }
    });
    if (!response.ok) throw new Error(`Privacy request failed (${response.status}).`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}

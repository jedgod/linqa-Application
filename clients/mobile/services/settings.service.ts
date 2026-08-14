import type { AccessTokenProvider } from "./session";

export interface NotificationPreferences {
  messages: boolean;
  calls: boolean;
  communities: boolean;
  business: boolean;
  mentionsOnly: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | null;
  priorityContactIds: string[];
}

export interface UserSettings {
  fontScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
  liveCaptions: boolean;
  autoDownloadMedia: boolean;
  autoCleanupMedia: boolean;
  aiMode: "DISABLED" | "ON_DEVICE" | "CONFIDENTIAL_CLOUD";
}

export class SettingsService {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: AccessTokenProvider
  ) {}

  getNotifications() {
    return this.request<NotificationPreferences>("/v1/notification-preferences");
  }

  saveNotifications(preferences: NotificationPreferences) {
    return this.request<void>("/v1/notification-preferences", {
      method: "PUT",
      body: JSON.stringify(preferences)
    });
  }

  getUserSettings() {
    return this.request<UserSettings>("/v1/user-settings");
  }

  saveUserSettings(settings: UserSettings) {
    return this.request<void>("/v1/user-settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.tokens.getAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init.headers
      }
    });
    if (!response.ok) throw new Error(`Settings request failed (${response.status}).`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
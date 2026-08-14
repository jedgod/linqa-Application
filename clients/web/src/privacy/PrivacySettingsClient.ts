export interface PrivacySettings {
  profileVisibility: "EVERYONE" | "CONTACTS" | "NOBODY";
  phoneDiscoverability: boolean;
  emailDiscoverability: boolean;
  usernameDiscoverability: boolean;
  readReceipts: boolean;
  typingIndicators: boolean;
  lastSeenVisibility: "EVERYONE" | "CONTACTS" | "NOBODY";
}

export class PrivacySettingsClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  async update(settings: PrivacySettings): Promise<void> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}/v1/privacy/settings`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(settings)
    });

    if (!response.ok) throw new Error("Unable to update privacy settings.");
  }
}

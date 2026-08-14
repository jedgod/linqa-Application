export class ReleasePromotionClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  async request(input: {
    milestoneCode: "1.0" | "2.0" | "3.0";
    featureKey: string;
    releaseChannel:
      | "INTERNAL"
      | "ALPHA"
      | "BETA"
      | "CANARY"
      | "GENERAL_AVAILABILITY";
    rolloutPercentage: number;
    evidence?: Record<string, unknown>;
  }) {
    return this.post("/v1/admin/promotions", input);
  }

  async approve(promotionId: string) {
    return this.post(
      `/v1/admin/promotions/${promotionId}/approve`,
      {}
    );
  }

  async rollback(promotionId: string, reason: string) {
    return this.post(
      `/v1/admin/promotions/${promotionId}/rollback`,
      { reason }
    );
  }

  private async post(path: string, body: unknown) {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error ?? `Request failed: ${response.status}`);
    }
    return payload;
  }
}

export type SafetyReportCategory =
  | "HARASSMENT"
  | "IMPERSONATION"
  | "THREATS"
  | "SCAM"
  | "SEXUAL_CONTENT"
  | "HATE"
  | "MINOR_SAFETY"
  | "OTHER";

export class SafetyClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

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

    if (!response.ok) {
      throw new Error("Safety request failed.");
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async block(blockedUserId: string, reason?: string) {
    return this.post("/v1/safety/blocks", {
      blockedUserId,
      reason
    });
  }

  async report(input: {
    reportedUserId?: string;
    callId?: string;
    category: SafetyReportCategory;
    description: string;
  }) {
    return this.post("/v1/safety/reports", input);
  }
}

export type MessageRequest = {
  id: string;
  senderUserId: string;
  senderDisplayName: string;
  preview: string;
  mutualContacts: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  createdAt: string;
};

export class MessageRequestService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>,
  ) {}

  async list(): Promise<MessageRequest[]> {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}/v1/message-requests`, {
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Unable to load message requests (${response.status}).`);
    }

    const payload = await response.json();
    return payload.requests ?? [];
  }

  async resolve(
    requestId: string,
    action: "ACCEPT" | "DECLINE" | "BLOCK" | "REPORT",
  ) {
    const token = await this.getAccessToken();
    const response = await fetch(
      `${this.apiBaseUrl}/v1/message-requests/${requestId}/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      },
    );

    if (!response.ok) {
      throw new Error(`Unable to resolve request (${response.status}).`);
    }
  }
}

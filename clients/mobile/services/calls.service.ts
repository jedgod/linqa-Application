export type CallHistoryItem = {
  id: string;
  peerUserId: string;
  peerDisplayName: string;
  direction: "INCOMING" | "OUTGOING";
  callType: "AUDIO" | "VIDEO" | "SCREEN_SHARE";
  status: "MISSED" | "REJECTED" | "COMPLETED" | "FAILED" | "CANCELLED";
  durationSeconds: number;
  createdAt: string;
};

export class CallsService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  async listHistory(limit = 100): Promise<CallHistoryItem[]> {
    const token = await this.getAccessToken();
    const response = await fetch(
      `${this.apiBaseUrl}/v1/calls/history?limit=${limit}`,
      { headers: { authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      throw new Error(`Unable to load calls (${response.status}).`);
    }

    const payload = await response.json();
    return (payload.calls ?? []).map((item: any) => ({
      id: item.id,
      peerUserId: item.peer_user_id,
      peerDisplayName: item.display_name ?? "Unknown contact",
      direction: item.direction,
      callType: item.call_type,
      status: item.status,
      durationSeconds: item.duration_seconds ?? 0,
      createdAt: item.created_at
    }));
  }

  async schedule(input: {
    participantUserIds: string[];
    callType: "AUDIO" | "VIDEO";
    privacyMode: "STANDARD" | "RELAY_ONLY";
    scheduledFor: string;
    titleCiphertextBase64?: string;
  }) {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}/v1/calls/scheduled`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      throw new Error(`Unable to schedule call (${response.status}).`);
    }

    return response.json();
  }
}

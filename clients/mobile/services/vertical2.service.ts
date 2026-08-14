export class Vertical2Service {
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
        ...(init?.body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) })
    });
    if (!response.ok) throw new Error(`Vertical 2 request failed (${response.status}).`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  inviteContact(recipientUserId: string) {
    return this.request("/v2/contacts/invites", { method: "POST", body: { recipientUserId } });
  }

  resolveContactInvite(inviteId: string, action: "ACCEPT" | "DECLINE" | "BLOCK") {
    return this.request<void>(`/v2/contacts/invites/${inviteId}/resolve`, { method: "POST", body: { action } });
  }

  createCommunity(input: { name: string; visibility: "PRIVATE" | "INVITE" | "PUBLIC" }) {
    return this.request("/v2/communities", { method: "POST", body: input });
  }

  joinCommunity(communityId: string) {
    return this.request<void>(`/v2/communities/${communityId}/join`, { method: "POST" });
  }

  createCalendarEvent(input: {
    titleCiphertextBase64: string;
    descriptionCiphertextBase64?: string;
    startsAt: string;
    endsAt: string;
    attendeeUserIds: string[];
  }) {
    return this.request("/v2/calendar/events", { method: "POST", body: input });
  }

  createNote(input: {
    noteType: "NOTE" | "CHECKLIST" | "DRAWING" | "VOICE";
    ciphertextBase64: string;
    collaborators: Array<{ userId: string; permission: "VIEW" | "EDIT" }>;
  }) {
    return this.request("/v2/notes", { method: "POST", body: input });
  }

  requestScreenShare(callId: string, shareType: "SCREEN" | "WINDOW" | "APPLICATION" | "WHITEBOARD") {
    return this.request(`/v2/calls/${callId}/screen-share`, { method: "POST", body: { shareType } });
  }

  decideScreenShare(sessionId: string, consented: boolean) {
    return this.request<void>(`/v2/screen-share/${sessionId}/consent`, { method: "POST", body: { consented } });
  }

  createAiJob(input: {
    jobType: "SUMMARIZE" | "TRANSLATE" | "REWRITE" | "MEETING_NOTES";
    privacyMode: "ON_DEVICE" | "CONFIDENTIAL_CLOUD" | "DISABLED";
    inputCiphertextBase64?: string;
  }) {
    return this.request("/v2/ai/jobs", { method: "POST", body: input });
  }

  wallet() {
    return this.request<{ items: Array<{ id: string; item_type: string; data_ciphertext: string }> }>("/v2/wallet");
  }

  addWalletItem(itemType: "CARD" | "IDENTITY" | "PASS" | "LOYALTY" | "MEMBERSHIP" | "PAYMENT_REFERENCE", ciphertextBase64: string) {
    return this.request("/v2/wallet", { method: "POST", body: { itemType, ciphertextBase64 } });
  }

  entitlements() {
    return this.request<{ entitlements: unknown[] }>("/v2/entitlements");
  }

  createOrganization(name: string, slug: string) {
    return this.request("/v2/enterprise/organizations", { method: "POST", body: { name, slug } });
  }

  triggerEmergency(eventType: "SOS" | "SILENT_ALERT" | "LIVE_LOCATION" | "EMERGENCY_VIDEO", encryptedPayloadBase64?: string) {
    return this.request("/v2/emergency/events", { method: "POST", body: { eventType, encryptedPayloadBase64 } });
  }
}
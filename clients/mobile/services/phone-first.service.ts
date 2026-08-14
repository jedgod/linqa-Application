export type PhoneFirstSession = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresAt: string;
};

export class PhoneFirstIdentityService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly getAccessToken: () => Promise<string>
  ) {}

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${await this.getAccessToken()}`,
        ...(init?.body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : `phone-first request failed (${response.status})`);
    }
    return payload as T;
  }

  start(installationId: string, detectedCountryIso2?: string) {
    return this.request<{ id: string; state: string; expires_at: string }>("/v6/registration/start", {
      method: "POST", body: { installationId, detectedCountryIso2 }
    });
  }

  submitPhone(flowId: string, countryIso2: string, nationalNumber: string) {
    return this.request<{
      state: string; phoneIdentityId: string; challengeId?: string; expiresAt?: string;
    }>(`/v6/registration/${flowId}/phone`, {
      method: "POST", body: { countryIso2, nationalNumber }
    });
  }

  verifyPhone(flowId: string, input: { phoneIdentityId: string; challengeId: string; code: string }) {
    return this.request<{ state: "RECOVERY_EMAIL_REQUIRED" }>(`/v6/registration/${flowId}/phone/verify`, {
      method: "POST", body: input
    });
  }

  startRecoveryEmail(flowId: string, email: string) {
    return this.request<{
      state: "EMAIL_OTP_REQUIRED"; identityId: string; challengeId: string; maskedEmail: string; expiresAt: string;
    }>(`/v6/registration/${flowId}/recovery-email`, {
      method: "POST", body: { email }
    });
  }

  verifyRecoveryEmail(flowId: string, input: { identityId: string; challengeId: string; code: string }) {
    return this.request<{ state: "RECOVERY_EMAIL_VERIFIED" }>(`/v6/registration/${flowId}/recovery-email/verify`, {
      method: "POST", body: input
    });
  }

  activate(flowId: string) {
    return this.request<{
      state: "ACCOUNT_ACTIVATED";
      accountSlot: 1 | 2 | 3;
      deviceEnrollmentRequired: boolean;
      session: PhoneFirstSession | null;
    }>(`/v6/registration/${flowId}/activate`, { method: "POST", body: {} });
  }
}

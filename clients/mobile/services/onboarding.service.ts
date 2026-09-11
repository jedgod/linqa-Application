import type { AccessTokenProvider } from "./session";
import { startupRequest } from "./startup-request";

export type OnboardingNextStep = "AUTH_REQUIRED" | "DEVICE_ENROLLMENT" | "RECOVERY_SETUP" |
  "COUNTRY_CONFIRMATION" | "COUNTRY_DISCOVERY" | "SECURITY_REVIEW" | "COMPLETION" | "COMPLETE";
export type OnboardingStatus = {
  phoneVerified: boolean; deviceEnrollmentRequired: boolean; recoveryReady: boolean;
  recoveryRequired: boolean; countryInitialized: boolean; countryVerificationState: string;
  discoveryConfigured: boolean; blockers: string[];
  detectedCountry: { code: string; name: string; callingCode: string | null } | null;
  onboardingCompletedAt: string | null; completionScreenSeen: boolean;
  nextStep: OnboardingNextStep;
};

export class OnboardingApiService {
  constructor(private readonly baseUrl: string, private readonly tokens: AccessTokenProvider) {}
  async status(): Promise<OnboardingStatus> {
    const response = await startupRequest(`${this.baseUrl}/v1/onboarding/status`, {
      headers: { authorization: `Bearer ${await this.tokens.getAccessToken()}` }
    });
    if (response.status === 401) throw new Error("AUTH_REQUIRED");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Unable to resolve onboarding.");
    return data as OnboardingStatus;
  }
  async acknowledgeCompletion(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/onboarding/complete`, {
      method: "POST", headers: { authorization: `Bearer ${await this.tokens.getAccessToken()}` }
    });
    if (!response.ok) throw new Error("Unable to complete onboarding.");
  }
}

export type IdentifierPurpose =
  | "REGISTRATION"
  | "LOGIN"
  | "ADD_IDENTIFIER"
  | "RECOVERY"
  | "HIGH_RISK_ACTION";

export interface RequestedChallenge {
  challengeId: string;
  expiresAt: string;
  resendAfter: string;
}

function mapAuthFailure(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid_or_expired_code") || normalized.includes("expired") || normalized.includes("incorrect")) {
    return "That code is expired or incorrect. Please request a new one.";
  }
  if (normalized.includes("invalid_request") || normalized.includes("not a valid") || normalized.includes("phone number") || normalized.includes("email")) {
    return "Please check the phone number or email you entered.";
  }
  if (normalized.includes("too many") || normalized.includes("rate limit") || normalized.includes("rate-limit")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (normalized.includes("network") || normalized.includes("fetch")) {
    return "Network error. Please check your connection and try again.";
  }
  return fallback;
}

export class AuthClient {
  constructor(private readonly baseUrl: string) {}

  async requestCode(identifier: string, purpose: IdentifierPurpose): Promise<RequestedChallenge> {
    const response = await fetch(`${this.baseUrl}/v1/auth/challenges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier, purpose })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(mapAuthFailure(payload?.error, "Unable to request a verification code."));
    }

    return {
      challengeId: payload.challengeId,
      expiresAt: payload.expiresAt,
      resendAfter: payload.resendAfter
    };
  }

  async verifyCode(challengeId: string, code: string) {
    const response = await fetch(`${this.baseUrl}/v1/auth/challenges/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId, code })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(mapAuthFailure(payload?.error, "Verification failed."));
    }
    return payload;
  }

  async registerVerifiedPhone(challengeId: string) {
    const response = await fetch(`${this.baseUrl}/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? "Phone registration failed.");
    return payload;
  }

  async refresh(refreshToken: string) {
    const response = await fetch(`${this.baseUrl}/v1/auth/sessions/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });

    if (!response.ok) throw new Error("Session refresh failed.");
    return response.json();
  }

  async enrollSecureDevice(temporarySession: {
    accessToken: string; accessTokenExpiresIn: number; refreshToken: string;
    refreshTokenExpiresAt: string; sessionId: string;
  }) {
    const { enrollBrowserWithRustCore } = await import("../auth/SecureDeviceEnrollment");
    return enrollBrowserWithRustCore({ baseUrl: this.baseUrl, temporarySession });
  }
}

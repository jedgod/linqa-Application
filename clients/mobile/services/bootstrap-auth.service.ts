/**
 * Wraps the server's real first-account bootstrap flow: server/src/routes/
 * auth.ts (/v1/auth/challenges, /v1/auth/challenges/verify, /v1/auth/
 * register) and server/src/routes/enrollment.ts (/v1/device-enrollment/*).
 * MultiAccountApiService (services/multi-account.service.ts) always sends a
 * bearer token via accessTokenProvider, which is exactly what these
 * pre-session endpoints don't have yet — hence a separate client here.
 */
import { startupRequest } from "./startup-request";

export type RawSession = {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
};

export interface ChallengeVerifyResult {
  accountExists: boolean;
  registrationRequired?: boolean;
  authenticationRequired?: string;
  temporarySession?: RawSession;
  verifiedIdentifier?: { type: "PHONE" | "EMAIL"; value: string };
}

export interface DeviceEnrollmentChallenge {
  challengeId: string;
  userId: string;
  nonceBase64: string;
  expiresAt: string;
}

export interface DeviceEnrollmentResult {
  deviceId: string;
  status: string;
  session: RawSession;
}

export class BootstrapAuthService {
  constructor(private readonly apiBaseUrl: string) {}

  private async request<T>(
    path: string,
    options: { method: string; body?: unknown; accessToken?: string }
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;

    const response = await startupRequest(`${this.apiBaseUrl}${path}`, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : `Request to ${path} failed (${response.status}).`;
      throw new Error(message);
    }

    return data as T;
  }

  requestChallenge(identifier: string, purpose: "REGISTRATION" | "LOGIN") {
    return this.request<{ challengeId: string; expiresAt: string; resendAfter: string }>("/v1/auth/challenges", {
      method: "POST",
      body: { identifier, purpose }
    });
  }

  verifyChallenge(challengeId: string, code: string) {
    return this.request<ChallengeVerifyResult>("/v1/auth/challenges/verify", {
      method: "POST",
      body: { challengeId, code }
    });
  }

  register(challengeId: string) {
    return this.request<{ accountCreated: boolean; temporarySession: RawSession }>("/v1/auth/register", {
      method: "POST",
      body: { challengeId }
    });
  }

  requestDeviceEnrollmentChallenge(accessToken: string) {
    return this.request<DeviceEnrollmentChallenge>("/v1/device-enrollment/challenges", {
      method: "POST",
      accessToken
    });
  }

  completeDeviceEnrollment(
    accessToken: string,
    body: {
      challengeId: string;
      deviceName: string;
      platform: "WEB" | "DESKTOP" | "ANDROID" | "IOS";
      signingPublicKeyBase64: string;
      encryptionPublicKeyBase64: string;
      signatureBase64: string;
    }
  ) {
    return this.request<DeviceEnrollmentResult>("/v1/device-enrollment/complete", {
      method: "POST",
      accessToken,
      body
    });
  }
}

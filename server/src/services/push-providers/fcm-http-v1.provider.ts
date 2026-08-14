import { SignJWT, importPKCS8 } from "jose";

const TOKEN_LIFETIME_MS = 55 * 60 * 1000; // Google access tokens last 1h; refresh at 55min.
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Real implementation of PushV2Provider's FCM half (2026-08-07): the
 * standard Google service-account JWT-bearer OAuth2 flow (sign a short-lived
 * RS256 JWT with the service account's private key, exchange it for an
 * access token, call FCM HTTP v1) implemented with `jose` (already a
 * dependency) + fetch — no firebase-admin dependency needed. Sends a
 * data-only message (no "notification" block) so delivery stays a silent
 * wake-up signal, matching the pack's "push contains no plaintext message
 * content" invariant.
 */
export class FcmHttpV1Provider {
  private cachedAccessToken: { token: string; issuedAt: number } | null = null;

  constructor(
    private readonly projectId: string,
    private readonly clientEmail: string,
    private readonly privateKey: string
  ) {}

  private async accessToken(): Promise<string> {
    if (this.cachedAccessToken && Date.now() - this.cachedAccessToken.issuedAt < TOKEN_LIFETIME_MS) {
      return this.cachedAccessToken.token;
    }

    const key = await importPKCS8(this.privateKey, "RS256");
    const assertion = await new SignJWT({ scope: FCM_SCOPE })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(this.clientEmail)
      .setAudience(TOKEN_ENDPOINT)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    });

    if (!response.ok) {
      throw new Error(`FCM OAuth2 token exchange failed (${response.status}).`);
    }

    const body = (await response.json()) as { access_token: string };
    this.cachedAccessToken = { token: body.access_token, issuedAt: Date.now() };
    return body.access_token;
  }

  async health(): Promise<void> { await this.accessToken(); }

  async send(input: { token: string; payload: Record<string, unknown> }): Promise<{ messageId?: string }> {
    const accessToken = await this.accessToken();

    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.payload)) {
      data[key] = typeof value === "string" ? value : JSON.stringify(value);
    }

    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token: input.token,
          data,
          android: { priority: "high" },
          apns: { headers: { "apns-priority": "5", "apns-push-type": "background" } }
        }
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`FCM delivery failed (${response.status}): ${text}`);
    }

    const body = (await response.json()) as { name?: string };
    return { ...(body.name !== undefined ? { messageId: body.name } : {}) };
  }
}

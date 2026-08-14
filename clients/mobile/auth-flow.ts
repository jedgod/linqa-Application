/**
 * Reference auth-flow client for a future React Native (or similar) mobile
 * shell. No mobile client project exists in this repo yet (Android/iOS are
 * native Kotlin/Swift) — this is a standalone building block for when one
 * does, matching the server's /v1/auth/* contract.
 */
export interface SecureTokenStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  clear(): Promise<void>;
}

export class MobileAuthFlow {
  private pendingChallengeId: string | null = null;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly tokenStore: SecureTokenStore
  ) {}

  async requestCode(identifier: string): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/v1/auth/challenges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier,
        purpose: "LOGIN"
      })
    });

    if (!response.ok) throw new Error("Could not send verification code.");

    // challengeId does not reveal whether the identifier has an account
    // (the server's response is otherwise deliberately generic) — it is
    // just the opaque handle needed to reach verifyCode below.
    const payload = await response.json();
    this.pendingChallengeId = payload.challengeId;
  }

  async verifyCode(code: string) {
    if (!this.pendingChallengeId) {
      throw new Error("No pending verification challenge. Call requestCode first.");
    }

    const response = await fetch(`${this.apiBaseUrl}/v1/auth/challenges/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: this.pendingChallengeId, code })
    });

    if (!response.ok) throw new Error("Verification failed.");
    const payload = await response.json();
    this.pendingChallengeId = null;

    const refreshToken = payload?.temporarySession?.refreshToken;
    if (typeof refreshToken === "string") {
      await this.tokenStore.setRefreshToken(refreshToken);
    }

    return payload;
  }

  async logout(): Promise<void> {
    await this.tokenStore.clear();
  }
}

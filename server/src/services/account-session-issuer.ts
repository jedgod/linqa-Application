import type { SessionIssuer } from "./account-switch.service.js";
import type { SessionService } from "./session.service.js";

/**
 * Adapts the existing SessionService (already used by routes/enrollment.ts
 * to issue device-bound sessions) to AccountSwitchService's SessionIssuer
 * interface, instead of building a second session-issuance mechanism.
 */
export class SessionServiceAccountIssuer implements SessionIssuer {
  constructor(private readonly sessions: SessionService) {}

  async issueForAccount(input: { userId: string; deviceId: string; installationId: string }) {
    const session = await this.sessions.create({
      userId: input.userId,
      subject: input.userId,
      deviceId: input.deviceId,
      scopes: ["account:write", "devices:read"]
    });

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      sessionId: session.sessionId,
      expiresAt: session.refreshTokenExpiresAt.toISOString()
    };
  }
}

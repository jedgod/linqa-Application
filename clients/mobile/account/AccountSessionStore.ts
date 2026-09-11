import type { AccountSecureStorage } from "./AccountSecureStorage";

export type AccountSession = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresAt: string;
};

export class AccountSessionStore {
  constructor(private readonly secure: AccountSecureStorage) {}

  async save(session: AccountSession) {
    await this.secure.put(session.userId, "session", JSON.stringify(session));
  }

  async load(userId: string): Promise<AccountSession | null> {
    const raw = await this.secure.get(userId, "session");

    if (!raw) return null;
    const session = JSON.parse(raw) as AccountSession;
    // Earlier builds stored the refresh-token expiry here. Decoding only
    // schedules refresh; the server still verifies the token on every request.
    try {
      const payload = session.accessToken.split(".")[1];
      if (!payload) throw new Error("Missing token payload");
      const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
      const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
      if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) throw new Error("Missing expiry");
      const storedExpiry = new Date(session.expiresAt).getTime();
      session.expiresAt = new Date(Math.min(Number.isFinite(storedExpiry) ? storedExpiry : 0, claims.exp * 1000)).toISOString();
    } catch {
      session.expiresAt = new Date(0).toISOString();
    }
    return session;
  }

  async remove(userId: string) {
    await this.secure.remove(userId, "session");
  }
}

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
    return JSON.parse(raw) as AccountSession;
  }

  async remove(userId: string) {
    await this.secure.remove(userId, "session");
  }
}

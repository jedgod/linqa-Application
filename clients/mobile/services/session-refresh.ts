import type { AccountSession, AccountSessionStore } from "../account/AccountSessionStore";
import { startupRequest } from "./startup-request";

type SessionStore = Pick<AccountSessionStore, "load" | "save" | "remove">;

export function createSessionRefresher(store: SessionStore, apiUrl: string) {
  const refreshes = new Map<string, Promise<AccountSession | null>>();
  return async (userId: string): Promise<AccountSession | null> => {
    const existing = refreshes.get(userId);
    if (existing) return existing;
    const refresh = (async () => {
      const stored = await store.load(userId);
      if (!stored || new Date(stored.expiresAt).getTime() > Date.now() + 30_000) return stored;
      const response = await startupRequest(`${apiUrl}/v1/auth/sessions/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: stored.refreshToken })
      });
      // A temporary server outage must not erase a valid refresh token.
      if (response.status === 401) {
        await store.remove(userId);
        return null;
      }
      if (!response.ok) throw new Error("Linqa could not resume your session. Please try again.");
      const next = await response.json();
      if (typeof next.accessToken !== "string" || !next.accessToken ||
          typeof next.refreshToken !== "string" || !next.refreshToken ||
          typeof next.accessTokenExpiresIn !== "number" || !Number.isFinite(next.accessTokenExpiresIn) ||
          next.accessTokenExpiresIn <= 0) {
        throw new Error("Linqa received an invalid session response. Please try again.");
      }
      const session = {
        ...stored,
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        expiresAt: new Date(Date.now() + next.accessTokenExpiresIn * 1000).toISOString()
      };
      await store.save(session);
      return session;
    })().finally(() => refreshes.delete(userId));
    refreshes.set(userId, refresh);
    return refresh;
  };
}

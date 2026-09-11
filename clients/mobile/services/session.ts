export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}
import { registerAccountScopeReset } from "./account-scope";

/**
 * 2026-08-07 apply pass: `activeAccountSessionResolver` is a bridge between
 * this module-level singleton and the AccountProvider React context added
 * by the multi-account pack. `AccountSessionBridge` (mounted once in
 * app/_layout.tsx, inside AccountProvider) calls
 * `setActiveAccountSessionResolver` whenever the active account changes, so
 * that once a user has verified a phone number and an account is active,
 * every existing screen that already calls `accessTokenProvider
 * .getAccessToken()` (Calls, Media, Privacy Center, ...) starts resolving a
 * real token instead of always throwing. Before any account is active, or
 * if the stored session is missing/expired, this still fails closed exactly
 * as before — no behavior is faked.
 */
type SessionResolver = () => Promise<{ accessToken: string; expiresAt: string } | null>;

let activeAccountSessionResolver: SessionResolver | null = null;
registerAccountScopeReset("authentication", () => { activeAccountSessionResolver = null; });

export function setActiveAccountSessionResolver(resolver: SessionResolver | null): void {
  activeAccountSessionResolver = resolver;
}

export class FailClosedAccessTokenProvider implements AccessTokenProvider {
  async getAccessToken(): Promise<string> {
    if (activeAccountSessionResolver) {
      // A connection/storage failure is retryable, not proof of an invalid
      // session. Still fail closed: never return an expired token.
      const session = await activeAccountSessionResolver().catch((error) => {
        console.warn("[session] active account session resolver failed:", error);
        throw new Error("Linqa could not resume your session. Check your connection and try again.");
      });
      if (session && new Date(session.expiresAt).getTime() > Date.now()) {
        return session.accessToken;
      }
    }

    throw new Error(
      "No active authenticated session is available. Sign in again to continue."
    );
  }
}

export const accessTokenProvider: AccessTokenProvider =
  new FailClosedAccessTokenProvider();

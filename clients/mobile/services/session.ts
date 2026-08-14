export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

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

export function setActiveAccountSessionResolver(resolver: SessionResolver | null): void {
  activeAccountSessionResolver = resolver;
}

export class FailClosedAccessTokenProvider implements AccessTokenProvider {
  async getAccessToken(): Promise<string> {
    if (activeAccountSessionResolver) {
      // A resolver failure (e.g. secure storage unavailable) must still
      // fail closed with the same clear error below, not leak a raw
      // storage exception to whatever screen is awaiting this token.
      const session = await activeAccountSessionResolver().catch((error) => {
        console.warn("[session] active account session resolver failed:", error);
        return null;
      });
      if (session && new Date(session.expiresAt).getTime() > Date.now()) {
        return session.accessToken;
      }
    }

    throw new Error(
      "No secure session service is configured for this mobile client yet."
    );
  }
}

export const accessTokenProvider: AccessTokenProvider =
  new FailClosedAccessTokenProvider();

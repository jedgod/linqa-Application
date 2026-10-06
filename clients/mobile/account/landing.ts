/**
 * Where to go after switching to another account.
 *
 * Always the onboarding resolver, for every account. It reads the SERVER's view
 * of that account's progress and sends a finished account straight to Home, so a
 * half-finished one cannot be skipped past. The destination must never depend on
 * the account's display label (an account named "Research" must not bypass it).
 */
export const ACCOUNT_SWITCH_LANDING_ROUTE = "/onboarding/resolve";

import type { NavRoute } from "./registry";

export type NavigationContext = {
  signedIn: boolean;
  /** `null` while LinqaSend availability is still loading: treated as unavailable. */
  moneyAvailable: boolean | null;
};

/**
 * Whether a registry route may be offered in the sidebar / breadcrumbs.
 * Fail-closed and UI-only: screens and the API still enforce their own access.
 */
export function mayShowRoute(route: NavRoute, ctx: NavigationContext): boolean {
  if (!ctx.signedIn) return false;
  if (route.money && ctx.moneyAvailable !== true) return false;
  return true;
}

/** Paths where the shell must not appear: pre-auth, onboarding and modal flows. */
const SHELL_FREE_PREFIXES = [
  "/welcome",
  "/onboarding",
  "/account/sign-up",
  "/account/add-",
  "/account/remove",
  "/account/max-limit",
  "/countrylinqa/chat-access",
  "/linqasend/authorize",
  "/linqasend/status",
  "/status/"
];

export function shellAllowedOnPath(pathname: string): boolean {
  return !SHELL_FREE_PREFIXES.some((p) => pathname.startsWith(p));
}

export function normalizePath(path: string): string {
  return path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
}

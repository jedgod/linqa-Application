export type NavigationContext = {
  authenticated: boolean;
  onboardingComplete: boolean;
  allowedRouteIds: ReadonlySet<string>;
};
export function mayNavigate(routeId: string, context: NavigationContext): boolean {
  return context.authenticated && context.onboardingComplete && context.allowedRouteIds.has(routeId);
}
export function normalizeRoute(path: string): string {
  const stripped = path.split(/[?#]/, 1)[0];
  return stripped.replace(/\/+$/, '') || '/';
}
export function shouldReplace(currentPath: string, targetPath: string): boolean {
  return normalizeRoute(currentPath) === normalizeRoute(targetPath);
}

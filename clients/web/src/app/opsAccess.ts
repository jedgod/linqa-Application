// UI-only gate for showing the staff Operations entry point. This never
// enforces anything -- every /v1/admin/operations/* route independently
// checks the real scope via requireScope() in server/src/auth/jwt.ts. This
// just avoids showing a staff-only button to every consumer user, since
// clients/web currently has no other concept of "is this account staff".
export function hasAnyOpsScope(accessToken: string): boolean {
  const scope = decodeScopeClaim(accessToken);
  if (!scope) return false;
  return scope.split(/\s+/).some((s) => s.startsWith("ops:"));
}

// Same UI-only caveat as hasAnyOpsScope: purely for deciding what to show
// (e.g. disabling the Approve button before a specialist even tries it).
// The server independently re-checks the real scope on every request.
export function hasOpsScope(accessToken: string, scope: string): boolean {
  const claim = decodeScopeClaim(accessToken);
  if (!claim) return false;
  return claim.split(/\s+/).includes(scope);
}

function decodeScopeClaim(token: string): string | null {
  try {
    const [, payloadSegment] = token.split(".");
    if (!payloadSegment) return null;
    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
    const payload = JSON.parse(json);
    return typeof payload?.scope === "string" ? payload.scope : null;
  } catch {
    return null;
  }
}

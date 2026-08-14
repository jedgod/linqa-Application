import { createRemoteJWKSet, jwtVerify } from "jose";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * Real OIDC ID-token verification (2026-08-07), using `jose` (already a
 * dependency) — fetches and caches the issuer's JWKS and verifies
 * signature, issuer, audience, and expiry. This is deliberately just the
 * verification primitive, not a full interactive SSO login flow: a
 * production SSO login also needs an authorization-code redirect, a
 * callback route, CSRF `state` and replay-resistant `nonce` handling, and
 * session issuance — none of which existed anywhere in this repo before
 * this pack and none of which this change fabricates. Hand-rolling that
 * flow hastily is a real way to introduce an auth bypass; it deserves its
 * own careful pass. SAML is excluded entirely for the same reason (XML
 * signature/canonicalization bugs are a classic real-world vulnerability
 * class) and is not implemented here.
 */
export async function verifyOidcIdToken(input: {
  idToken: string;
  issuer: string;
  audience: string;
}): Promise<{ subject: string; email?: string; claims: Record<string, unknown> }> {
  let jwks = jwksCache.get(input.issuer);
  if (!jwks) {
    const wellKnown = await fetch(`${input.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
    if (!wellKnown.ok) {
      throw new Error(`Unable to fetch OIDC discovery document for issuer ${input.issuer}`);
    }
    const discovery = (await wellKnown.json()) as { jwks_uri: string };
    jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    jwksCache.set(input.issuer, jwks);
  }

  const { payload } = await jwtVerify(input.idToken, jwks, {
    issuer: input.issuer,
    audience: input.audience
  });

  if (typeof payload.sub !== "string") {
    throw new Error("OIDC ID token missing subject claim");
  }

  return {
    subject: payload.sub,
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    claims: payload as Record<string, unknown>
  };
}

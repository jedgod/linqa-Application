import { createRemoteJWKSet, importSPKI, jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { AuthPrincipal } from "./types.js";

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new Error("missing bearer token");
  }
  return header.slice("Bearer ".length);
}

export function createAuthenticator(config: AppConfig) {
  const developmentKey = new TextEncoder().encode(config.JWT_HS256_SECRET);
  const productionKey = config.JWT_VERIFYING_PUBLIC_KEY_PEM
    ? importSPKI(config.JWT_VERIFYING_PUBLIC_KEY_PEM, "EdDSA")
    : null;
  const remoteKeys = config.JWT_JWKS_URL
    ? createRemoteJWKSet(new URL(config.JWT_JWKS_URL))
    : null;

  return async function authenticate(request: FastifyRequest): Promise<AuthPrincipal> {
    const token = bearerToken(request);
    if (config.NODE_ENV === "production" && !productionKey) {
      throw new Error("production first-party JWT verification is not configured");
    }

    const verificationKey = productionKey
      ? await productionKey
      : remoteKeys ?? developmentKey;
    const { payload } = await jwtVerify(token, verificationKey, {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      algorithms: productionKey ? ["EdDSA"] : remoteKeys ? ["RS256", "ES256", "EdDSA"] : ["HS256"]
    });

    const userId = typeof payload.user_id === "string" ? payload.user_id : undefined;
    if (!payload.sub || !userId) {
      throw new Error("token is missing required identity claims");
    }

    const scopes = new Set(
      typeof payload.scope === "string"
        ? payload.scope.split(/\s+/).filter(Boolean)
        : []
    );

    const deviceId = typeof payload.device_id === "string" ? payload.device_id : undefined;
    const sessionId = typeof payload.sid === "string" ? payload.sid : undefined;

    return {
      subject: payload.sub,
      userId,
      scopes,
      ...(deviceId !== undefined ? { deviceId } : {}),
      ...(sessionId !== undefined ? { sessionId } : {})
    };
  };
}

export class ScopeAuthorizationError extends Error {
  readonly status = 403;
  readonly code = "FORBIDDEN";
  constructor() { super("Forbidden"); this.name = "ScopeAuthorizationError"; }
}

export function requireScope(principal: AuthPrincipal, scope: string): void {
  if (!principal.scopes.has(scope)) {
    throw new ScopeAuthorizationError();
  }
}

import { jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import type { AuthPrincipal } from "./types.js";

function readBearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new Error("missing bearer token");
  }
  return header.slice(7);
}

export function createAuthenticator(config: AppConfig) {
  const key = new TextEncoder().encode(config.JWT_HS256_SECRET);

  return async function authenticate(request: FastifyRequest): Promise<AuthPrincipal> {
    const token = readBearer(request);
    const { payload } = await jwtVerify(token, key, {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      algorithms: ["HS256"]
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.user_id !== "string" ||
      typeof payload.device_id !== "string"
    ) {
      throw new Error("missing identity claims");
    }

    return {
      subject: payload.sub,
      userId: payload.user_id,
      deviceId: payload.device_id,
      scopes: new Set(
        typeof payload.scope === "string"
          ? payload.scope.split(/\s+/).filter(Boolean)
          : []
      )
    };
  };
}

export function requireScope(principal: AuthPrincipal, scope: string): void {
  if (!principal.scopes.has(scope)) {
    throw new Error(`missing scope: ${scope}`);
  }
}

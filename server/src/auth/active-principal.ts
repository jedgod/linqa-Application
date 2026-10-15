import type { AuthPrincipal } from "./types.js";
import type { SqlClient } from "../db/migration-runner.js";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { createAuthenticator } from "./jwt.js";

export class InactivePrincipalError extends Error {}

/** Reusable adapter for route families that previously verified signatures only. */
export function createActiveAuthenticator(config: AppConfig, db: SqlClient) {
  const verify = createAuthenticator(config);
  return async (request: FastifyRequest): Promise<AuthPrincipal> => {
    const principal = await verify(request);
    await assertActivePrincipal(db, principal);
    return principal;
  };
}

/** Persistent revocation is authoritative; a cache TTL must never reactivate a device or session. */
export async function assertActivePrincipal(db: SqlClient, principal: AuthPrincipal): Promise<void> {
  if (principal.deviceId) {
    const result = await db.query("SELECT 1 FROM devices WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND revoked_at IS NULL", [principal.deviceId, principal.userId]);
    if (result.rowCount !== 1) throw new InactivePrincipalError("DEVICE_AUTHENTICATION_REVOKED");
  }
  if (principal.sessionId) {
    const result = await db.query(`SELECT 1 FROM auth_sessions
      WHERE id=$1 AND user_id=$2 AND device_id IS NOT DISTINCT FROM $3::uuid
        AND revoked_at IS NULL AND expires_at>now()`, [principal.sessionId, principal.userId, principal.deviceId ?? null]);
    if (result.rowCount !== 1) throw new InactivePrincipalError("SESSION_AUTHENTICATION_REVOKED");
  }
}

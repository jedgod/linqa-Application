import type { AppConfig } from "../config.js";
import type { SqlClient } from "../db/migration-runner.js";
import type { FastifyRequest } from "fastify";
import { createActiveAuthenticator, InactivePrincipalError } from "./active-principal.js";

export function createPaymentAuthenticator(config: AppConfig, db: SqlClient) {
  const authenticate = createActiveAuthenticator(config, db);
  return async (request: FastifyRequest) => {
    const principal = await authenticate(request);
    if (!principal.deviceId || !principal.sessionId) throw new InactivePrincipalError("PAYMENT_DEVICE_SESSION_REQUIRED");
    const user = await db.query("SELECT 1 FROM users WHERE id=$1 AND status='ACTIVE'", [principal.userId]);
    if (user.rowCount !== 1) throw new InactivePrincipalError("PAYMENT_ACCOUNT_INACTIVE");
    return principal;
  };
}

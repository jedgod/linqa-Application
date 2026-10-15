import type { WebSocket } from "ws";
import type { SqlClient } from "../db/migration-runner.js";
import type { AuthPrincipal } from "../auth/types.js";
import { assertActivePrincipal } from "../auth/active-principal.js";

/** Recheck on traffic and every 15 seconds while idle. Database failures close the socket. */
export function createSocketSessionGuard(socket: WebSocket, principal: AuthPrincipal, db: SqlClient) {
  let stopped = false;
  let inFlight: Promise<boolean> | undefined;
  const authorize = (): Promise<boolean> => {
    if (stopped || socket.readyState !== socket.OPEN) return Promise.resolve(false);
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        if (!principal.deviceId || !principal.expiresAt || principal.expiresAt * 1000 <= Date.now()) throw new Error("TOKEN_EXPIRED");
        await assertActivePrincipal(db, principal);
        // Expiry can pass while the database request is in flight.
        if (stopped || principal.expiresAt * 1000 <= Date.now()) throw new Error("TOKEN_EXPIRED");
        return true;
      } catch {
        stopped = true;
        socket.close(4003, "authorization no longer valid");
        return false;
      }
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const timer = setInterval(() => { void authorize(); }, 15_000);
  timer.unref?.();
  const dispose = () => { stopped = true; clearInterval(timer); };
  socket.once("close", dispose);
  socket.once("error", dispose);
  return { authorize, dispose };
}

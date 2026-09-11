import test from "node:test";
import assert from "node:assert/strict";
import { AccountSessionStore } from "../clients/mobile/account/AccountSessionStore.ts";
import { createRequire } from "node:module";
import { registerAuthRoutes } from "../server/src/routes/auth.ts";
import { InvalidRefreshTokenError, SessionService } from "../server/src/services/session.service.ts";

test("signing failure does not rotate or commit the device's refresh token", async () => {
  const statements: string[] = [];
  const connection = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: sql.includes("SELECT s.*") ? [{
        id: "session", user_id: "user", external_subject: "subject",
        expires_at: new Date(Date.now() + 86400_000), access_scope: ["profile:read"]
      }] : [] };
    },
    release: () => {}
  };
  const service = new SessionService({ connect: async () => connection } as never, {
    NODE_ENV: "production", JWT_SIGNING_PRIVATE_KEY_PEM: "invalid-signing-key"
  } as never);
  await assert.rejects(service.rotate({ refreshToken: "current-refresh-token" }));
  assert.equal(statements.some((sql) => sql.includes("UPDATE auth_sessions")), false);
  assert.equal(statements.includes("COMMIT"), false);
  assert.equal(statements.includes("ROLLBACK"), true);
});

test("legacy sessions use JWT access expiry, not refresh-token lifetime", async () => {
  const exp = Math.floor(Date.now() / 1000) - 60;
  const token = "header." + Buffer.from(JSON.stringify({ exp })).toString("base64url") + ".signature";
  const store = new AccountSessionStore({
    get: async () => JSON.stringify({ userId: "user", accessToken: token, refreshToken: "refresh", sessionId: "session", expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() })
  } as never);
  assert.equal((await store.load("user"))?.expiresAt, new Date(exp * 1000).toISOString());
});

test("unknown token expiry forces refresh instead of trusting stored lifetime", async () => {
  const store = new AccountSessionStore({
    get: async () => JSON.stringify({ userId: "user", accessToken: "invalid", expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() })
  } as never);
  assert.equal((await store.load("user"))?.expiresAt, new Date(0).toISOString());
});

test("refresh endpoint separates invalid credentials from temporary backend failures", async (t) => {
  const require = createRequire(new URL("../server/package.json", import.meta.url));
  const app = require("fastify")();
  let failure: Error = new Error("database unavailable");
  await registerAuthRoutes(app, {} as never, {} as never, {
    sessionService: { rotate: async () => { throw failure; } }
  } as never);
  t.after(() => app.close());
  const request = { method: "POST", url: "/v1/auth/sessions/refresh", payload: { refreshToken: "x".repeat(48) } };
  assert.equal((await app.inject(request)).statusCode, 503);
  failure = new InvalidRefreshTokenError("invalid refresh token");
  assert.equal((await app.inject(request)).statusCode, 401);
});

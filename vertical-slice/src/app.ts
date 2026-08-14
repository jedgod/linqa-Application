import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/pool.js";
import { RealtimeHub } from "./realtime/hub.js";
import { registerRealtime } from "./realtime/register.js";
import { registerKeyPackageRoutes } from "./routes/key-packages.js";
import { registerRelayRoutes } from "./routes/relay.js";

export async function buildApp(config: AppConfig, db: Database) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "body.ciphertextBase64",
        "body.packageBase64"
      ]
    },
    genReqId: () => randomUUID(),
    bodyLimit: config.MAX_ENVELOPE_BYTES * 2,
    requestTimeout: 15000
  });

  // Registered before any plugin (in particular @fastify/websocket, which
  // otherwise resets it during its own boot sequence — a Fastify/avvio
  // plugin-ordering subtlety: register() calls are queued and actually run
  // at listen()-time in registration order, so a setErrorHandler() call
  // placed textually "after" register() can still lose to a plugin's
  // internal handler set during boot. See server/src/app.ts for the same
  // fix applied to the main server.)
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    void reply.code(500).send({
      error: "internal_error",
      requestId: request.id
    });
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false
  });

  await app.register(cors, {
    origin: false,
    credentials: false
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute"
  });

  const hub = new RealtimeHub();

  app.get("/health/live", async () => ({
    status: "ok",
    version: process.env.npm_package_version ?? "development"
  }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await db.query("SELECT 1");
      const migration = await db.query(
        `SELECT 1 FROM schema_migrations WHERE version = '001_vertical_slice'`
      );

      if (migration.rowCount !== 1) {
        return reply.code(503).send({
          status: "not-ready",
          reason: "required migration missing"
        });
      }

      return {
        status: "ready",
        version: process.env.npm_package_version ?? "development"
      };
    } catch {
      return reply.code(503).send({
        status: "not-ready",
        reason: "database unavailable"
      });
    }
  });

  await registerRealtime(app, config, db, hub);
  await registerKeyPackageRoutes(app, config, db);
  await registerRelayRoutes(app, config, db, hub);

  return app;
}

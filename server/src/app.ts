import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import rawBody from "fastify-raw-body";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/pool.js";
import { createServiceContainer } from "./bootstrap/service-container.js";
import { registerAll } from "./bootstrap/register-all.js";
import { registerMetrics } from "./observability/metrics.js";
import { enforceProductionBoot } from "./runtime/bootstrap-gate.js";
import { configureLinqaSendProviders, resetLinqaSendProvidersToSafeDefaults } from "./integrations/linqasend/provider.registry.js";
import { createHttpLinqaSendProviders } from "./integrations/linqasend/http.providers.js";

export async function buildApp(config: AppConfig, db: Database) {
  resetLinqaSendProvidersToSafeDefaults();
  if (config.LINQASEND_PROVIDER_URL && config.LINQASEND_PROVIDER_TOKEN) {
    configureLinqaSendProviders(createHttpLinqaSendProviders(config.LINQASEND_PROVIDER_URL, config.LINQASEND_PROVIDER_TOKEN));
  }
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "body.ciphertextBase64",
        "body.packageBase64",
        "body.code",
        "body.refreshToken",
        "body.manifestHashBase64",
        "body.tokens",
        "body.providerToken",
        "body.providerSecret",
        "body.reference"
      ]
    },
    genReqId: () => randomUUID(),
    bodyLimit: config.MAX_ENVELOPE_BYTES * 2,
    requestTimeout: 15_000,
    trustProxy: false
  });

  // Registered before any plugin (in particular @fastify/websocket, which
  // otherwise resets it during its own boot sequence — a Fastify/avvio
  // plugin-ordering subtlety, not a JS statement-order issue: register()
  // calls are queued and actually run at listen()-time in registration
  // order, so a setErrorHandler() call placed textually "after" register()
  // can still lose to a plugin's internal handler set during boot).
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
    origin: config.CORS_ORIGINS,
    credentials: true
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute"
  });
  await app.register(rawBody, { field: "rawBody", global: false, encoding: false, runFirst: true });

  const metrics = registerMetrics(app);
  const services = createServiceContainer(config, db);
  await enforceProductionBoot(config.NODE_ENV, services.runtimeCapabilities);

  app.get("/health/live", async () => ({
    status: "ok",
    version: process.env.npm_package_version ?? "development"
  }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await db.query("SELECT 1");
      if (config.NODE_ENV === "production") {
        await services.runtimeCapabilities.requireReady([
          "database", "secure-core", "delivery", "message-relay", "key-transparency"
        ]);
      }
      return {
        status: "ready",
        version: process.env.npm_package_version ?? "development"
      };
    } catch {
      return reply.code(503).send({ status: "not-ready" });
    }
  });

  await registerAll(app, config, db, services, metrics);

  return app;
}

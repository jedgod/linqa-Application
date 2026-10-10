import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildApp } from "./app.js";
import { resolveLocalPorts } from "./config/ports.js";
import { assertVaultProductionReady } from "./services/vault-operations.js";
import { startVaultWorkers } from "./vault-workers.js";

const config = loadConfig();
const db = createPool(config);
// With Vault production switched on, refuse to start unless every machine-checkable gate passes.
await assertVaultProductionReady(db, process.env, async () => { await db.query("SELECT 1"); return true; });
const app = await buildApp(config, db);
const stopVaultWorkers = startVaultWorkers(db, process.env, app.log);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  stopVaultWorkers();
  await app.close();
  await db.end();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// LINQA_API_PORT is a local-only override for Windows port conflicts — see
// server/README_INTEGRATION.md. The shipped default stays config.PORT (8080).
const { apiPort } = resolveLocalPorts(process.env);
await app.listen({ host: config.HOST, port: apiPort });

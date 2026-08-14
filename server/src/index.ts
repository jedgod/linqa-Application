import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildApp } from "./app.js";
import { resolveLocalPorts } from "./config/ports.js";

const config = loadConfig();
const db = createPool(config);
const app = await buildApp(config, db);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
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

import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const db = createPool(config);
const app = await buildApp(config, db);

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await db.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({
  host: config.HOST,
  port: Number(process.env.LINQA_API_PORT ?? config.PORT)
});

import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";
import { migrate } from "./migration-runner.js";

const config = loadConfig();
const db = createPool(config);
try {
  await migrate(
    db,
    resolve(process.env.LINQA_MIGRATIONS_DIR ?? "src/db/migrations"),
    process.env.npm_package_version ?? "development"
  );
  console.log("Migration completed.");
} finally {
  await db.end();
}

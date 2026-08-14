import pg from "pg";
import type { AppConfig } from "../config.js";

const { Pool } = pg;

export function createPool(config: AppConfig) {
  return new Pool({
    connectionString: config.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    application_name: "linqa-vertical-slice"
  });
}

export type Database = ReturnType<typeof createPool>;

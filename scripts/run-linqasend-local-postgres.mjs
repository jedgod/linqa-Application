// Disposable database on an existing loopback PostgreSQL server, never the app database.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { migrate } from "../server/src/db/migration-runner.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = path.join(root, "server");
const require = createRequire(path.join(server, "package.json"));
const { Pool } = require("pg");
const url = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only an existing loopback PostgreSQL server is allowed");
const database = `linqa_send_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
let created = false, pool;
try {
  await admin.query(`CREATE DATABASE "${database}"`); created = true;
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.href, max: 4 });
  const client = await pool.connect();
  try { await migrate(client, path.join(server, "src/db/migrations"), "send-money-disposable-test"); }
  finally { client.release(); }
  const result = await promisify(execFile)(process.execPath, ["node_modules/vitest/vitest.mjs", "run",
    "src/tests/linqasend-payment-intent.test.ts", "src/tests/linqasend-payment-intent.integration.test.ts",
    "src/tests/linqasend-v7-execution.integration.test.ts", "--maxWorkers=1"], {
    cwd: server, windowsHide: true, timeout: 300_000, maxBuffer: 8_000_000,
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL: url.href, LINQA_REQUIRE_DB_TESTS: "1" }
  });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  // Avoid echoing command/env strings that could contain connection credentials.
  console.error("Isolated send-money database validation failed:", error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await pool?.end();
  if (created) { await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); console.log("Disposable send-money database removed."); }
  await admin.end();
}

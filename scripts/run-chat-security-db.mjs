import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { migrate } from "../server/src/db/migration-runner.ts";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const server = path.join(root, "server");
const require = createRequire(path.join(server, "package.json"));
const { Pool } = require("pg");
const project = `linqa-security-test-${process.pid}`;
const compose = ["compose", "--project-name", project, "--file", path.join(root, "docker-compose.test.yml")];
const docker = (...args) => exec("docker", [...compose, ...args], { cwd: root, windowsHide: true, timeout: 120_000 });
let started = false;
let pool;
try {
  // Fail before creating anything when Docker is inaccessible. Never use a developer/production DATABASE_URL.
  await exec("docker", ["info", "--format", "{{.ServerVersion}}"], { windowsHide: true, timeout: 15_000 });
  started = true;
  await docker("up", "--detach", "--wait", "test-db");
  const { stdout } = await docker("port", "test-db", "5432");
  const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(stdout);
  if (!match) throw new Error("Test database must have a loopback-only published port");
  const url = `postgresql://linqa_test:disposable_test_password@127.0.0.1:${match[1]}/linqa_security_test`;
  pool = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 2000 });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { await pool.query("SELECT 1"); break; }
    catch { if (Date.now() >= deadline) throw new Error("PostgreSQL test database did not become ready"); await delay(500); }
  }
  // Migrations need a single session for advisory locks and transactions.
  const client = await pool.connect();
  try { await migrate(client, path.join(server, "src/db/migrations"), "chat-security-integration"); }
  finally { client.release(); }
  const result = await exec(process.execPath, ["node_modules/vitest/vitest.mjs", "run",
    "src/tests/chat/route-security.test.ts", "src/tests/chat/realtime-security.test.ts", "src/tests/chat/shared-attachment.routes.test.ts",
    "src/tests/chats-inbox.route.test.ts", "src/tests/production-auth-policy.test.ts", "src/tests/chat/chat-v2.integration.test.ts", "src/tests/chat/thread-attachment.integration.test.ts",
    "src/tests/chat/session-lifecycle.test.ts", "src/tests/chat/session-revocation.integration.test.ts",
    "--maxWorkers=1", "--testTimeout=30000", "--hookTimeout=30000"], {
    cwd: server, windowsHide: true, timeout: 600_000, maxBuffer: 8_000_000,
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL: url, LINQA_REQUIRE_DB_TESTS: "1" }
  });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  console.error("Dedicated chat security database run failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
  if (started) {
    try { await docker("down", "--volumes", "--remove-orphans"); }
    catch (error) { console.error("Test database cleanup failed:", error.message); process.exitCode = 1; }
  }
}

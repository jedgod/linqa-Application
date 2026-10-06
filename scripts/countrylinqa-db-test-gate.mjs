// Runs the PostgreSQL integration suites and fails if ANY test was skipped.
// Refuses any database that is not clearly a throwaway one (see assert-dedicated-test-db.mjs):
// the CountryLinqa suite rolls everything back, but the chat suite writes rows.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkDedicatedDatabase } from "./assert-dedicated-test-db.mjs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for CountryLinqa certification.");
  process.exit(2);
}
const guard = checkDedicatedDatabase();
if (!guard.ok) { console.error(guard.message); process.exit(guard.code); }
console.log(guard.message);
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clq-gate-")), "result.json");
const result = spawnSync("npx", [
  "vitest", "run",
  "src/tests/countrylinqa-engine.integration.test.ts",
  "src/tests/chat/chat-v2.integration.test.ts",
  "--reporter=verbose", "--reporter=json", `--outputFile.json=${out}`
], { cwd: "server", stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, LINQA_REQUIRE_DB_TESTS: "1" } });
if (result.status !== 0) process.exit(result.status ?? 1);

const report = JSON.parse(fs.readFileSync(out, "utf8"));
const skipped = report.numPendingTests + report.numTodoTests;
console.log(`integration tests: ${report.numPassedTests} passed, ${skipped} skipped/todo, ${report.numFailedTests} failed`);
if (report.numTotalTests === 0 || skipped > 0) {
  console.error("FAIL: integration tests were skipped. A certification run must execute all of them.");
  process.exit(4);
}

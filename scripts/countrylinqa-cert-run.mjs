// Software certification: the checks CI (or a developer with a dedicated test database) can prove.
// It does NOT include physical devices; see docs/countrylinqa/RELEASE_EXECUTION_ORDER.md.
import { spawnSync } from "node:child_process";

function run(label, command, args, cwd = ".") {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, LINQA_REQUIRE_DB_TESTS: "1" } });
  if ((result.status ?? 1) !== 0) {
    console.error(`${label}_FAILED`);
    process.exit(result.status ?? 1);
  }
}

run("Dedicated database guard", "node", ["scripts/assert-dedicated-test-db.mjs"]);
run("Skip audit", "node", ["scripts/audit-vitest-skips.mjs"]);
run("PostgreSQL tests, none skipped", "node", ["scripts/countrylinqa-db-test-gate.mjs"]);
run("Certification tooling tests", process.execPath, ["--import", "./server/node_modules/tsx/dist/loader.mjs", "--test", "tests/countrylinqa-certification.test.ts"]);
run("Repository inventory", "node", ["scripts/countrylinqa-certification.mjs", "--software-only"]);

console.log("\nCOUNTRYLINQA_SOFTWARE_CERTIFICATION=PASS");

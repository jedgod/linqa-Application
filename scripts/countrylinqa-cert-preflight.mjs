// Run before cutting a release candidate: clean tree, then the full software gate,
// server build and tests, and mobile typecheck and tests. Needs a dedicated test database.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

function run(label, command, args, cwd = ".") {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, LINQA_REQUIRE_DB_TESTS: "1" } });
  if ((result.status ?? 1) !== 0) {
    console.error(`${label}_FAILED`);
    process.exit(result.status ?? 1);
  }
}

const dirty = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", shell: process.platform === "win32" }).stdout?.trim();
if (dirty) {
  console.error("Working tree is not clean:\n" + dirty.split("\n").slice(0, 15).join("\n"));
  console.error("\nCommit or stash unrelated edits before release certification.");
  process.exit(2);
}

run("Software certification", "node", ["scripts/countrylinqa-cert-run.mjs"]);
if (fs.existsSync("server/package.json")) {
  run("Server build", "npm", ["run", "build"], "server");
  run("Server tests", "npm", ["test"], "server");
}
if (fs.existsSync("clients/mobile/package.json")) {
  run("Mobile typecheck", "npm", ["run", "typecheck"], "clients/mobile");
  run("Mobile tests", process.execPath, ["--import", "./server/node_modules/tsx/dist/loader.mjs", "--test", "tests/mobile-app.test.ts"]);
}

console.log("\nCOUNTRYLINQA_CERT_PREFLIGHT=PASS");

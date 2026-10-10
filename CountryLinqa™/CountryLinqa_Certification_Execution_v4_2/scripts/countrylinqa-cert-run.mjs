import {spawnSync} from "node:child_process";

function run(cmd,args,cwd="."){
  const r=spawnSync(cmd,args,{
    cwd,stdio:"inherit",shell:process.platform==="win32",
    env:{...process.env,LINQA_REQUIRE_DB_TESTS:"1"}
  });
  if((r.status ?? 1)!==0) process.exit(r.status ?? 1);
}

run("node",["scripts/assert-dedicated-test-db.mjs"]);
run("node",["scripts/audit-vitest-skips.mjs"]);
run("node",["scripts/countrylinqa-db-test-gate.mjs"]);

// Keep existing repo certification script authoritative.
run("node",["scripts/countrylinqa-certification.mjs","--software-only"]);

console.log("COUNTRYLINQA_SOFTWARE_CERTIFICATION=PASS");
